import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { getComposeContainerStatus, projectHasComposeFile } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";
import { deriveRuntimeStatus } from "@/lib/project-status";
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

  const history = db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, id))
    .orderBy(desc(deployments.startedAt))
    .limit(50)
    .all();

  const currentDeployment =
    history.find((d) => d.status === "success") ?? history[0] ?? null;

  const containers = await getComposeContainerStatus(project.clonePath);
  const isDeploying = isDeploymentActive(id);
  const hasSuccessfulDeploy = history.some((d) => d.status === "success");
  const runtimeStatus = deriveRuntimeStatus(containers, {
    isDeploying,
    hasSuccessfulDeploy,
    hasComposeFile: projectHasComposeFile(project.clonePath),
  });
  const hasComposeFile = projectHasComposeFile(project.clonePath);
  const branches = await listAvailableBranches(project.branch, project.clonePath);

  return NextResponse.json({
    project: projectResponse(project),
    deployments: history,
    currentDeployment,
    containers,
    isDeploying,
    runtimeStatus,
    hasComposeFile,
    branches,
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
    enabled?: boolean;
    deployEnvVars?: DeployEnvVarInput[];
  };

  const updates: Partial<typeof projects.$inferInsert> = {};

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
  db.delete(projects).where(eq(projects.id, id)).run();
  return NextResponse.json({ ok: true });
}
