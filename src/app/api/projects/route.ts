import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { agentSessions, deployments, gitRepositories, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { isDeploymentActive } from "@/lib/deployer";
import { getComposeContainerStatus, projectHasComposeFile } from "@/lib/docker";
import { deriveRuntimeStatus } from "@/lib/project-status";
import { composeProjectName } from "@/lib/compose-project-name";
import { projectComposeSlug } from "@/lib/projects";
import {
  findForgeProject,
  isForgeProject,
  isForgeSelfUpdateConfigured,
} from "@/lib/forge-project";
import { isForgeUpdateInProgress } from "@/lib/self-update";
import {
  createForgeGitRepository,
  forgeGitHttpsUrl,
  forgeGitSshUrl,
  gitRepositoryIsEmpty,
  importGithubToForge,
} from "@/lib/git-repo";
import { ensureGitCloneToken } from "@/lib/git-clone-token";
import { GIT_HTTPS_BASIC_USERNAME } from "@/lib/git-https-auth";
import { parseDockerImageRef } from "@/lib/docker-image-ref";
import { inspectImageContainerPort } from "@/lib/docker-image-inspect";
import { pickFreePort } from "@/lib/network-ports";
import { serializeDeployEnv, type DeployEnvVar } from "@/lib/deploy-env";
import { deployProject } from "@/lib/project-deploy";
import { importHostDirectoryToRepo } from "@/lib/git-import-host-path";
import { createAgentSession } from "@/lib/agent-runner";
import { projectBootstrapPrompt } from "@/lib/project-bootstrap-agent";
import { withRegistryDockerConfig } from "@/lib/docker-registry-auth";

const execFileAsync = promisify(execFile);

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

function projectHasLiveAgent(projectId: string): boolean {
  const live = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, [
          "running",
          "deploying",
          "queued",
          "pending",
        ]),
        isNull(agentSessions.archivedAt),
      ),
    )
    .limit(1)
    .get();
  return live !== undefined;
}

export async function GET() {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allProjects = db
    .select()
    .from(projects)
    .orderBy(projects.name)
    .all();

  const forgeProjectRow = findForgeProject();

  const enrichProject = async (project: (typeof allProjects)[number]) => {
      const latest = db
        .select()
        .from(deployments)
        .where(eq(deployments.projectId, project.id))
        .orderBy(desc(deployments.startedAt))
        .limit(1)
        .get();

      const latestSuccess = db
        .select()
        .from(deployments)
        .where(eq(deployments.projectId, project.id))
        .orderBy(desc(deployments.completedAt))
        .all()
        .find((d) => d.status === "success");

      const isDeploying =
        isDeploymentActive(project.id) ||
        (isForgeProject(project) && (await isForgeUpdateInProgress()));
      const containers = await getComposeContainerStatus(
        project.clonePath,
        projectComposeSlug(project),
      );
      const runtimeStatus = deriveRuntimeStatus(containers, {
        isDeploying,
        hasSuccessfulDeploy: latestSuccess !== undefined,
        hasComposeFile: projectHasComposeFile(project.clonePath),
      });

      const gitRepo = project.gitRepositoryId
        ? db
            .select()
            .from(gitRepositories)
            .where(eq(gitRepositories.id, project.gitRepositoryId))
            .get()
        : null;

      return {
        id: project.id,
        name: project.name,
        composeProjectName: composeProjectName(project.name),
        githubRepo: project.githubRepo,
        branch: project.branch,
        clonePath: project.clonePath,
        lastSeenCommit: project.lastSeenCommit,
        enabled: project.enabled,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        latestDeployment: latest ?? null,
        isDeploying,
        runtimeStatus,
        isForge: isForgeProject(project),
        hasLiveAgent: projectHasLiveAgent(project.id),
        workingTreeDirty: false,
        gitRepositoryId: project.gitRepositoryId,
        gitSlug: gitRepo?.slug ?? null,
        httpsCloneUrl: gitRepo ? forgeGitHttpsUrl(gitRepo.slug) : null,
        sshCloneUrl: gitRepo ? forgeGitSshUrl(gitRepo.slug) : null,
        importedFrom: gitRepo?.importedFrom ?? null,
        gitEmpty: gitRepositoryIsEmpty(gitRepo),
      };
  };

  const forgeProject = forgeProjectRow
    ? await enrichProject(forgeProjectRow)
    : null;

  const otherProjects = allProjects.filter(
    (project) => project.id !== forgeProjectRow?.id,
  );

  const projectsList = await Promise.all(otherProjects.map(enrichProject));

  return NextResponse.json({
    forgeProject,
    projects: projectsList,
    forgeConfigured: isForgeSelfUpdateConfigured(),
  });
}

export async function POST(request: Request) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    mode?: "create" | "import" | "local" | "image";
    name?: string;
    slug?: string;
    githubRepo?: string;
    branch?: string;
    hostPath?: string;
    image?: string;
    containerPort?: number;
    hostPort?: number;
    registryUser?: string;
    registryPassword?: string;
    registryUrl?: string;
  };

  const mode =
    body.mode ??
    (body.githubRepo?.trim() ? "import" : body.name?.trim() ? "create" : null);

  if (!mode) {
    return NextResponse.json(
      { error: "Provide mode=create, mode=import, mode=local, or mode=image" },
      { status: 400 },
    );
  }

  try {
    if (mode === "image") {
      const parsed = parseDockerImageRef(body.image ?? "");
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      const name = body.name?.trim() || parsed.nameHint;
      const hostPort =
        typeof body.hostPort === "number" && body.hostPort > 0
          ? body.hostPort
          : await pickFreePort(3456);
      let containerPort =
        typeof body.containerPort === "number" && body.containerPort > 0
          ? body.containerPort
          : null;
      if (containerPort == null) {
        await withRegistryDockerConfig(
          {
            IMAGE: parsed.image,
            FORGE_REGISTRY_USER: body.registryUser,
            FORGE_REGISTRY_PASSWORD: body.registryPassword,
            FORGE_REGISTRY_URL: body.registryUrl || parsed.registryHost || undefined,
          },
          async (env) => {
            try {
              await execFileAsync("docker", ["pull", parsed.image], { env });
            } catch {
              // inspect may still work if the image is already local
            }
            containerPort = await inspectImageContainerPort(parsed.image, env);
          },
        );
      }
      const resolvedPort = containerPort ?? 8080;
      const created = await createForgeGitRepository({
        name,
        slug: body.slug,
        defaultBranch: body.branch,
        imageSeed: {
          projectName: name,
          image: parsed.image,
          containerPort: resolvedPort,
          hostPort,
        },
      });
      const deployVars: DeployEnvVar[] = [
        { key: "IMAGE", value: parsed.image, secret: false },
        { key: "CONTAINER_PORT", value: String(resolvedPort), secret: false },
      ];
      if (parsed.registryHost) {
        deployVars.push({
          key: "FORGE_REGISTRY_URL",
          value: body.registryUrl?.trim() || parsed.registryHost,
          secret: false,
        });
      }
      if (body.registryUser?.trim()) {
        deployVars.push({
          key: "FORGE_REGISTRY_USER",
          value: body.registryUser.trim(),
          secret: false,
        });
      }
      if (body.registryPassword) {
        deployVars.push({
          key: "FORGE_REGISTRY_PASSWORD",
          value: body.registryPassword,
          secret: true,
        });
      }
      db.update(projects)
        .set({
          hostPort,
          deployEnvJson: serializeDeployEnv(deployVars),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, created.projectId))
        .run();
      const deploy = await deployProject({
        projectId: created.projectId,
        trigger: "manual",
      });
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, created.projectId))
        .get();
      return NextResponse.json(
        {
          ...project,
          httpsCloneUrl: created.httpsUrl,
          sshCloneUrl: created.sshUrl,
          gitSlug: created.slug,
          gitEmpty: false,
          gitCloneUsername: GIT_HTTPS_BASIC_USERNAME,
          gitCloneToken: ensureGitCloneToken(created.repositoryId),
          deploymentId: deploy.deploymentId,
        },
        { status: 201 },
      );
    }

    if (mode === "create" || mode === "local") {
      if (!body.name?.trim()) {
        return NextResponse.json(
          { error: "Name is required to create a project" },
          { status: 400 },
        );
      }
      const created = await createForgeGitRepository({
        name: body.name,
        slug: body.slug,
        defaultBranch: body.branch,
        seed: true,
      });
      const projectRow = db
        .select()
        .from(projects)
        .where(eq(projects.id, created.projectId))
        .get();
      let importError: string | null = null;
      if (body.hostPath?.trim() && projectRow) {
        try {
          await importHostDirectoryToRepo({
            hostPath: body.hostPath,
            clonePath: projectRow.clonePath,
          });
        } catch (err) {
          importError =
            err instanceof Error ? err.message : "Failed to import host path";
        }
      }
      let agentSessionId: string | null = null;
      let agentError: string | null = null;
      if (!importError) {
        try {
          const started = await createAgentSession(
            created.projectId,
            (body.branch?.trim() || projectRow?.branch || "main"),
            projectBootstrapPrompt({
              projectName: body.name,
              hostPath: body.hostPath,
            }),
          );
          agentSessionId = started.sessionId;
        } catch (err) {
          agentError =
            err instanceof Error ? err.message : "Failed to start bootstrap agent";
        }
      }
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, created.projectId))
        .get();
      const payload = {
        ...project,
        httpsCloneUrl: created.httpsUrl,
        sshCloneUrl: created.sshUrl,
        gitSlug: created.slug,
        gitEmpty: false,
        gitCloneUsername: GIT_HTTPS_BASIC_USERNAME,
        gitCloneToken: ensureGitCloneToken(created.repositoryId),
        agentSessionId,
        agentError,
        importError,
      };
      if (importError) {
        return NextResponse.json(payload, { status: 400 });
      }
      return NextResponse.json(payload, { status: 201 });
    }

    if (!body.githubRepo?.trim()) {
      return NextResponse.json(
        { error: "GitHub repository is required to import" },
        { status: 400 },
      );
    }

    const imported = await importGithubToForge({
      githubRepo: body.githubRepo,
      name: body.name,
      slug: body.slug,
      branch: body.branch,
    });
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, imported.projectId))
      .get();
    return NextResponse.json(
      {
        ...project,
        httpsCloneUrl: imported.httpsUrl,
        sshCloneUrl: imported.sshUrl,
        gitSlug: imported.slug,
        importedFrom: imported.importedFrom,
        gitEmpty: false,
        gitCloneUsername: GIT_HTTPS_BASIC_USERNAME,
        gitCloneToken: ensureGitCloneToken(imported.repositoryId),
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create project";
    const status =
      /already exists|conflict|Another project/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
