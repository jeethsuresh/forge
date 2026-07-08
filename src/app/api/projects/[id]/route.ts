import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { getComposeContainerStatus, projectHasComposeFile } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";
import { deriveRuntimeStatus } from "@/lib/project-status";
import { composeProjectName } from "@/lib/compose-project-name";
import { composeNameConflict, validateProjectName } from "@/lib/projects";
import {
  hasRollbackImage,
  projectSupportsRollback,
  readProjectReleaseState,
} from "@/lib/deploy-rollback";
import { reconcileInterruptedDeployments } from "@/lib/deploy-reconcile";
import { isForgeProject } from "@/lib/forge-project";
import { getForgeStatus, isForgeUpdateInProgress } from "@/lib/self-update";
import { listAvailableBranches } from "@/lib/github";
import {
  buildDeployEnvVarViews,
  fillDeployEnvFromRepo,
  mergeDeployEnvUpdates,
  parseDeployEnvJson,
  readRepoEnvFile,
  serializeDeployEnv,
  validateDeployEnvInputs,
  type DeployEnvVarInput,
} from "@/lib/deploy-env";

function projectResponse(project: typeof projects.$inferSelect) {
  const { deployEnvJson, ...rest } = project;
  const saved = parseDeployEnvJson(deployEnvJson);
  const repoEnv = readRepoEnvFile(project.clonePath);
  return {
    ...rest,
    composeProjectName: composeProjectName(rest.name),
    deployEnvVars: buildDeployEnvVarViews(saved, repoEnv.vars, repoEnv.source),
    deployEnvFileSource: repoEnv.source,
  };
}

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  reconcileInterruptedDeployments(id);

  const history = db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, id))
    .orderBy(desc(deployments.startedAt))
    .limit(50)
    .all();

  const currentDeployment =
    history.find((d) => d.status === "success") ?? history[0] ?? null;

  const containers = await getComposeContainerStatus(
    project.clonePath,
    project.name,
  );
  const isDeploying =
    isDeploymentActive(id) ||
    (isForgeProject(project) && (await isForgeUpdateInProgress()));
  const hasSuccessfulDeploy =
    history.some((d) => d.status === "success") ||
    Boolean(readProjectReleaseState(id, project)?.stableCommitSha);
  const runtimeStatus = deriveRuntimeStatus(containers, {
    isDeploying,
    hasSuccessfulDeploy,
    hasComposeFile: projectHasComposeFile(project.clonePath),
  });
  const hasComposeFile = projectHasComposeFile(project.clonePath);
  const branches = await listAvailableBranches(project.branch, project.clonePath);
  const supportsRollback = projectSupportsRollback(project);
  const rollbackAvailable = supportsRollback
    ? await hasRollbackImage(project)
    : false;
  const releaseState = readProjectReleaseState(id, project);
  const forge = isForgeProject(project);
  const forgeStatus = forge ? await getForgeStatus() : null;

  return NextResponse.json({
    project: {
      ...projectResponse(project),
      isForge: forge,
    },
    deployments: history,
    currentDeployment,
    containers,
    isDeploying,
    runtimeStatus,
    hasComposeFile,
    branches,
    supportsRollback,
    hasRollbackImage: rollbackAvailable,
    releaseState,
    forgeStatus,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: string;
    enabled?: boolean;
    deployEnvVars?: DeployEnvVarInput[];
  };

  const updates: Partial<typeof projects.$inferInsert> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return NextResponse.json(
        { error: "name must be a string" },
        { status: 400 },
      );
    }

    const trimmed = body.name.trim();
    const nameError = validateProjectName(trimmed);
    if (nameError) {
      return NextResponse.json({ error: nameError }, { status: 400 });
    }

    if (trimmed !== project.name) {
      if (isDeploymentActive(id)) {
        return NextResponse.json(
          { error: "Cannot rename while a deployment is in progress" },
          { status: 409 },
        );
      }

      const conflict = composeNameConflict(trimmed, id);
      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 409 });
      }

      updates.name = trimmed;
    }
  }

  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled;
  }

  if (body.deployEnvVars !== undefined) {
    if (!Array.isArray(body.deployEnvVars)) {
      return NextResponse.json(
        { error: "deployEnvVars must be an array" },
        { status: 400 },
      );
    }

    const validationError = validateDeployEnvInputs(body.deployEnvVars);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const existing = parseDeployEnvJson(project.deployEnvJson);
    const repoEnv = readRepoEnvFile(project.clonePath);
    const inputs =
      repoEnv.source === ".env"
        ? fillDeployEnvFromRepo(body.deployEnvVars, repoEnv.vars)
        : body.deployEnvVars;
    const merged = mergeDeployEnvUpdates(existing, inputs);
    updates.deployEnvJson = serializeDeployEnv(merged);
  }

  if (Object.keys(updates).length > 0) {
    db.update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .run();
  }

  const updated = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!updated) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json(projectResponse(updated));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (isForgeProject(project)) {
    return NextResponse.json(
      { error: "The Forge project cannot be removed from the dashboard" },
      { status: 403 },
    );
  }

  db.delete(projects).where(eq(projects.id, id)).run();
  return NextResponse.json({ ok: true });
}
