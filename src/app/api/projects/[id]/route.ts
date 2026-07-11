import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { getComposeContainerStatus, projectHasComposeFile } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";
import { deriveRuntimeStatus } from "@/lib/project-status";
import { composeProjectName } from "@/lib/compose-project-name";
import { getBlockingAgentSession } from "@/lib/agent-state";
import { composeNameConflict, projectComposeSlug, validateProjectName } from "@/lib/projects";
import {
  hasRollbackImage,
  projectSupportsRollback,
  readProjectReleaseState,
} from "@/lib/deploy-rollback";
import {
  reconcileAbandonedDeployingSessions,
  reconcileInterruptedDeployments,
} from "@/lib/deploy-reconcile";
import { isForgeProject } from "@/lib/forge-project";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { getForgeStatus } from "@/lib/self-update";
import { listAvailableBranches } from "@/lib/github";
import {
  getCachedProjectBranches,
  setCachedProjectBranches,
} from "@/lib/project-branches-cache";
import { deploymentRowForClient } from "@/lib/project-poll";
import {
  getCachedComposeContainerStatus,
  getCachedRollbackAvailability,
} from "@/lib/project-runtime-cache";
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
import {
  normalizeProjectRoutingUpdates,
  parseProjectCaddyConfig,
  projectRoutingView,
  serializeProjectCaddyConfig,
  syncProjectCaddyRoute,
  validateProjectRoutingInput,
  type ProjectCaddySettings,
} from "@/lib/project-routing";

function projectResponse(
  project: typeof projects.$inferSelect,
  options?: { includeRepoEnv?: boolean },
) {
  const { deployEnvJson, caddyRouteJson, ...rest } = project;
  void caddyRouteJson;
  const saved = parseDeployEnvJson(deployEnvJson);
  const repoEnv =
    options?.includeRepoEnv === false
      ? { source: null as ".env" | ".env.example" | null, vars: [] }
      : readRepoEnvFile(project.clonePath);
  const routing = projectRoutingView(project);
  return {
    ...rest,
    composeProjectName: composeProjectName(rest.name),
    deployEnvVars: buildDeployEnvVarViews(saved, repoEnv.vars, repoEnv.source),
    deployEnvFileSource: repoEnv.source,
    hostPort: routing.hostPort,
    resolvedHostPort: routing.resolvedHostPort,
    caddyRoute: routing.caddyRoute,
    linkedRouteKeys: routing.linkedRouteKeys,
    caddyConfig: routing.caddyConfig,
  };
}

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const poll = new URL(request.url).searchParams.get("poll") === "1";
  const project = db.select().from(projects).where(eq(projects.id, id)).get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!poll) {
    reconcileInterruptedDeployments(id);
    reconcileAbandonedDeployingSessions(id);
  }

  const history = db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, id))
    .orderBy(desc(deployments.startedAt))
    .limit(50)
    .all();

  const clientDeployments = history.map((row) =>
    deploymentRowForClient(row, { includeLogs: !poll }),
  );

  const currentDeployment =
    clientDeployments.find((d) => d.status === "success") ??
    clientDeployments[0] ??
    null;

  const hasComposeFile = projectHasComposeFile(project.clonePath);
  const forge = isForgeProject(project);
  const supportsRollback = projectSupportsRollback(project);

  const branchesPromise = (async () => {
    if (poll) {
      const cached = getCachedProjectBranches(id);
      if (cached) return cached;
      return listAvailableBranches(project.branch, project.clonePath, {
        fetchRemote: false,
      });
    }
    const branches = await listAvailableBranches(project.branch, project.clonePath);
    setCachedProjectBranches(id, branches);
    return branches;
  })();

  const composeSlug = projectComposeSlug(project);

  const containersPromise = poll
    ? getCachedComposeContainerStatus(
        id,
        project.clonePath,
        composeSlug,
        5_000,
      )
    : getComposeContainerStatus(project.clonePath, composeSlug);

  const rollbackPromise =
    supportsRollback && poll
      ? getCachedRollbackAvailability(id, project, 30_000)
      : supportsRollback
        ? hasRollbackImage(project)
        : Promise.resolve(false);

  const forgeStatusPromise = forge ? getForgeStatus() : Promise.resolve(null);

  const [containers, branches, rollbackAvailable, forgeStatus] = await Promise.all([
    containersPromise,
    branchesPromise,
    rollbackPromise,
    forgeStatusPromise,
  ]);

  const isDeploying =
    isDeploymentActive(id) ||
    (forge && Boolean(forgeStatus?.activeUpdate));
  const hasSuccessfulDeploy =
    clientDeployments.some((d) => d.status === "success") ||
    Boolean(readProjectReleaseState(id, project)?.stableCommitSha);
  const runtimeStatus = deriveRuntimeStatus(containers, {
    isDeploying,
    hasSuccessfulDeploy,
    hasComposeFile,
  });
  const releaseState = readProjectReleaseState(id, project);
  const blockingAgentSession = getBlockingAgentSession(id);

  return NextResponse.json({
    project: {
      ...projectResponse(project, { includeRepoEnv: !poll }),
      isForge: forge,
    },
    deployments: clientDeployments,
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
    blockingAgentSession: blockingAgentSession
      ? {
          id: blockingAgentSession.id,
          branch: blockingAgentSession.branch,
          status: blockingAgentSession.status,
          sessionSource: blockingAgentSession.sessionSource,
        }
      : null,
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
    hostPort?: number | null;
    caddyRoute?: ProjectCaddySettings | null;
    linkedRouteKeys?: string[];
    syncCaddy?: boolean;
  };

  const updates: Partial<typeof projects.$inferInsert> = {};
  let routingToSync: {
    caddyRoute: ProjectCaddySettings | null;
    hostPort: number | null;
    syncManaged: boolean;
  } | null = null;

  const routingTouched =
    body.hostPort !== undefined ||
    body.caddyRoute !== undefined ||
    body.linkedRouteKeys !== undefined;
  if (routingTouched) {
    const routingError = validateProjectRoutingInput({
      hostPort: body.hostPort,
      caddyRoute: body.caddyRoute,
      projectId: id,
    });
    if (routingError) {
      return NextResponse.json({ error: routingError }, { status: 400 });
    }

    const normalized = normalizeProjectRoutingUpdates(project, {
      hostPort: body.hostPort,
      caddyRoute: body.caddyRoute,
      linkedRouteKeys: body.linkedRouteKeys,
    });
    updates.hostPort = normalized.hostPort;
    updates.caddyRouteJson = normalized.caddyRouteJson;
    routingToSync = {
      caddyRoute: normalized.caddyRoute,
      hostPort: normalized.hostPort,
      syncManaged:
        body.caddyRoute !== undefined ||
        (body.hostPort !== undefined && normalized.caddyRoute?.enabled === true),
    };
  }

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

  if (routingToSync?.syncManaged && body.syncCaddy !== false) {
    try {
      const synced = await syncProjectCaddyRoute(
        id,
        routingToSync.caddyRoute,
        routingToSync.hostPort ?? projectRoutingView(updated).resolvedHostPort,
      );
      const config = parseProjectCaddyConfig(updated.caddyRouteJson);
      config.managed = synced;
      db.update(projects)
        .set({
          caddyRouteJson: serializeProjectCaddyConfig(config),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .run();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to sync Caddy route";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const finalProject =
    db.select().from(projects).where(eq(projects.id, id)).get() ?? updated;
  return NextResponse.json(projectResponse(finalProject));
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
      { error: `The ${APP_DISPLAY_NAME} project cannot be removed from the dashboard` },
      { status: 403 },
    );
  }

  db.delete(projects).where(eq(projects.id, id)).run();
  return NextResponse.json({ ok: true });
}
