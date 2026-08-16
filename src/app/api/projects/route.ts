import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, deployments, projects } from "@/lib/db/schema";
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
import { gitRepositories } from "@/lib/db/schema";

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
    mode?: "create" | "import" | "local";
    name?: string;
    slug?: string;
    githubRepo?: string;
    branch?: string;
  };

  const mode =
    body.mode ??
    (body.githubRepo?.trim() ? "import" : body.name?.trim() ? "create" : null);

  if (!mode) {
    return NextResponse.json(
      { error: "Provide mode=create, mode=import, or mode=local" },
      { status: 400 },
    );
  }

  try {
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
        seed: mode !== "local",
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
          gitEmpty: mode === "local",
        },
        { status: 201 },
      );
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
