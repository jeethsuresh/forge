import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { composeProjectName } from "@/lib/compose-project-name";
import { parseDeployEnvJson } from "@/lib/deploy-env";
import { validateRouteForm, type ParsedRoute } from "@/lib/caddy-config";
import { getCaddyConfig, loadCaddyConfig } from "@/lib/caddy";
import {
  applyHostPortToRoute,
  parseProjectCaddyConfig,
  PROJECT_ROUTE_KEY_PREFIX,
  serializeProjectCaddyConfig,
  syncProjectRouteInConfig,
  type ProjectCaddyConfig,
  type ProjectCaddySettings,
  type ProjectRoutingView,
} from "@/lib/project-routing-shared";

export type {
  ProjectCaddyConfig,
  ProjectCaddySettings,
  ProjectRoutingView,
} from "@/lib/project-routing-shared";
export {
  applyHostPortToRoute,
  collectProjectLogHosts,
  defaultProjectCaddyRoute,
  defaultUpstreamDial,
  hostsFromManagedRoute,
  parseProjectCaddyConfig,
  parseProjectCaddyJson,
  projectRouteStorageKey,
  resolveRoutesByKeys,
  routeDisplayLabel,
  serializeProjectCaddy,
  serializeProjectCaddyConfig,
  syncProjectRouteInConfig,
} from "@/lib/project-routing-shared";

const MIN_HOST_PORT = 1024;
const MAX_HOST_PORT = 65535;

export function isProjectManagedRoute(route: ParsedRoute): boolean {
  return route.key.startsWith(PROJECT_ROUTE_KEY_PREFIX);
}

export function validateHostPort(port: number | null | undefined): string | null {
  if (port === null || port === undefined) return null;
  if (!Number.isInteger(port)) return "Host port must be a whole number";
  if (port < MIN_HOST_PORT || port > MAX_HOST_PORT) {
    return `Host port must be between ${MIN_HOST_PORT} and ${MAX_HOST_PORT}`;
  }
  return null;
}

export function hostPortConflict(
  port: number,
  excludeProjectId?: string,
): string | null {
  const rows = db
    .select({ id: projects.id, name: projects.name, hostPort: projects.hostPort })
    .from(projects)
    .all();

  const conflict = rows.find(
    (project) =>
      project.id !== excludeProjectId &&
      project.hostPort !== null &&
      project.hostPort === port,
  );
  if (!conflict) return null;
  return `Port ${port} is already assigned to “${conflict.name}”`;
}

export function resolveHostPortFromDeployEnv(
  deployEnvJson: string,
): number | null {
  const env = parseDeployEnvJson(deployEnvJson);
  const hostPortVar = env.find(
    (item) => item.key.toUpperCase() === "HOST_PORT",
  );
  if (!hostPortVar?.value.trim()) return null;
  const parsed = Number.parseInt(hostPortVar.value.trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function resolveProjectHostPort(project: {
  hostPort: number | null;
  deployEnvJson: string;
}): number | null {
  if (project.hostPort !== null && project.hostPort !== undefined) {
    return project.hostPort;
  }
  return resolveHostPortFromDeployEnv(project.deployEnvJson);
}

export function projectRoutingView(project: {
  hostPort: number | null;
  caddyRouteJson: string | null;
  deployEnvJson: string;
}): ProjectRoutingView {
  const resolvedHostPort = resolveProjectHostPort(project);
  const caddyConfig = parseProjectCaddyConfig(project.caddyRouteJson);
  return {
    hostPort: project.hostPort,
    caddyConfig,
    caddyRoute: caddyConfig.managed,
    linkedRouteKeys: caddyConfig.linkedRouteKeys,
    resolvedHostPort,
  };
}

export async function syncProjectCaddyRoute(
  projectId: string,
  settings: ProjectCaddySettings | null,
  hostPort: number | null,
): Promise<ProjectCaddySettings | null> {
  const config = await getCaddyConfig();
  const { config: next, settings: synced } = syncProjectRouteInConfig(
    config,
    projectId,
    settings,
    hostPort,
  );
  await loadCaddyConfig(next);
  return synced;
}

export function validateProjectRoutingInput(input: {
  hostPort?: number | null;
  caddyRoute?: ProjectCaddySettings | null;
  projectId?: string;
}): string | null {
  if (input.hostPort !== undefined && input.hostPort !== null) {
    const portError = validateHostPort(input.hostPort);
    if (portError) return portError;
    const conflict = hostPortConflict(input.hostPort, input.projectId);
    if (conflict) return conflict;
  }

  if (input.caddyRoute?.enabled) {
    const routeError = validateRouteForm(input.caddyRoute.route);
    if (routeError) return routeError;
  }

  return null;
}

export function normalizeProjectRoutingUpdates(
  project: {
    id: string;
    hostPort: number | null;
    caddyRouteJson: string | null;
    deployEnvJson: string;
  },
  body: {
    hostPort?: number | null;
    caddyRoute?: ProjectCaddySettings | null;
    linkedRouteKeys?: string[];
  },
): {
  hostPort: number | null;
  caddyRouteJson: string | null;
  caddyRoute: ProjectCaddySettings | null;
  linkedRouteKeys: string[];
  caddyConfig: ProjectCaddyConfig;
} {
  const current = parseProjectCaddyConfig(project.caddyRouteJson);
  const nextHostPort =
    body.hostPort !== undefined ? body.hostPort : project.hostPort;
  const resolvedHostPort =
    nextHostPort ?? resolveHostPortFromDeployEnv(project.deployEnvJson);

  let nextManaged =
    body.caddyRoute !== undefined ? body.caddyRoute : current.managed;
  const nextLinked =
    body.linkedRouteKeys !== undefined
      ? [
          ...new Set(
            body.linkedRouteKeys
              .map((key) => key.trim())
              .filter(Boolean),
          ),
        ]
      : current.linkedRouteKeys;

  if (nextManaged?.enabled) {
    nextManaged = {
      ...nextManaged,
      route: applyHostPortToRoute(nextManaged.route, resolvedHostPort),
    };
  }

  const caddyConfig: ProjectCaddyConfig = {
    managed: nextManaged,
    linkedRouteKeys: nextLinked,
  };

  return {
    hostPort: nextHostPort,
    caddyRouteJson: serializeProjectCaddyConfig(caddyConfig),
    caddyRoute: nextManaged,
    linkedRouteKeys: nextLinked,
    caddyConfig,
  };
}

export function listProjectRoutingRows(): Array<{
  id: string;
  name: string;
  composeProjectName: string;
  hostPort: number | null;
  caddyRoute: ProjectCaddySettings | null;
  linkedRouteKeys: string[];
  resolvedHostPort: number | null;
}> {
  const rows = db.select().from(projects).orderBy(projects.name).all();
  return rows.map((project) => {
    const routing = projectRoutingView(project);
    return {
      id: project.id,
      name: project.name,
      composeProjectName: composeProjectName(project.name),
      hostPort: routing.hostPort,
      caddyRoute: routing.caddyRoute,
      linkedRouteKeys: routing.linkedRouteKeys,
      resolvedHostPort: routing.resolvedHostPort,
    };
  });
}

export interface RouteProjectLink {
  id: string;
  name: string;
  kind: "linked" | "managed";
}

export function buildRouteToProjectsIndex(): Map<string, RouteProjectLink[]> {
  const index = new Map<string, RouteProjectLink[]>();

  function append(routeKey: string, link: RouteProjectLink): void {
    const existing = index.get(routeKey) ?? [];
    if (existing.some((entry) => entry.id === link.id && entry.kind === link.kind)) {
      return;
    }
    index.set(routeKey, [...existing, link]);
  }

  for (const project of db.select().from(projects).all()) {
    const routing = projectRoutingView(project);
    if (routing.caddyRoute?.enabled && routing.caddyRoute.routeKey) {
      append(routing.caddyRoute.routeKey, {
        id: project.id,
        name: project.name,
        kind: "managed",
      });
    }
    for (const routeKey of routing.linkedRouteKeys) {
      append(routeKey, {
        id: project.id,
        name: project.name,
        kind: "linked",
      });
    }
  }

  for (const [routeKey, links] of index) {
    links.sort((a, b) => a.name.localeCompare(b.name));
    index.set(routeKey, links);
  }

  return index;
}

export function setProjectRouteLink(
  projectId: string,
  routeKey: string,
  linked: boolean,
): string[] {
  const trimmedKey = routeKey.trim();
  if (!trimmedKey) {
    throw new Error("routeKey is required");
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new Error("Project not found");
  }

  const routing = projectRoutingView(project);
  const managedKey = routing.caddyRoute?.routeKey ?? null;
  if (managedKey === trimmedKey) {
    throw new Error("This route is managed by the project and cannot be linked separately");
  }

  const current = new Set(routing.linkedRouteKeys);
  if (linked) {
    current.add(trimmedKey);
  } else {
    current.delete(trimmedKey);
  }

  const normalized = normalizeProjectRoutingUpdates(project, {
    linkedRouteKeys: [...current],
  });

  db.update(projects)
    .set({
      caddyRouteJson: normalized.caddyRouteJson,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .run();

  return normalized.linkedRouteKeys;
}
