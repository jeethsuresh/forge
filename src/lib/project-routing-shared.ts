import {
  defaultRouteFormValues,
  parseHttpRoutes,
  removeRouteFromConfig,
  upsertRouteInConfig,
  validateRouteForm,
  type ParsedRoute,
  type RouteFormValues,
} from "@/lib/caddy-config";

export interface ProjectCaddySettings {
  enabled: boolean;
  route: RouteFormValues;
  /** ParsedRoute.key after the route is synced to live Caddy config. */
  routeKey: string | null;
}

/** Stored in projects.caddy_route_json (supports legacy single-route shape). */
export interface ProjectCaddyConfig {
  managed: ProjectCaddySettings | null;
  linkedRouteKeys: string[];
}

export interface ProjectRoutingView {
  hostPort: number | null;
  caddyConfig: ProjectCaddyConfig;
  /** Managed route only (convenience). */
  caddyRoute: ProjectCaddySettings | null;
  linkedRouteKeys: string[];
  resolvedHostPort: number | null;
}

export const PROJECT_ROUTE_KEY_PREFIX = "forge-project:";

export function projectRouteStorageKey(projectId: string): string {
  return `${PROJECT_ROUTE_KEY_PREFIX}${projectId}`;
}

export function defaultUpstreamDial(hostPort: number | null): string {
  return `127.0.0.1:${hostPort ?? 3000}`;
}

export function defaultProjectCaddyRoute(
  hostPort: number | null,
): RouteFormValues {
  return {
    ...defaultRouteFormValues("srv0"),
    handlerKind: "reverse_proxy",
    upstreamDial: defaultUpstreamDial(hostPort),
  };
}

export function applyHostPortToRoute(
  route: RouteFormValues,
  hostPort: number | null,
): RouteFormValues {
  if (route.handlerKind !== "reverse_proxy") return route;
  const dial = defaultUpstreamDial(hostPort);
  if (route.upstreamDial.trim() === dial) return route;
  return { ...route, upstreamDial: dial };
}

export function parseProjectCaddyJson(
  raw: string | null | undefined,
): ProjectCaddySettings | null {
  return parseProjectCaddyConfig(raw).managed;
}

function parseLegacyManagedSettings(
  record: Record<string, unknown>,
): ProjectCaddySettings | null {
  if (!record.route || typeof record.route !== "object") return null;
  const route = record.route as Record<string, unknown>;
  return {
    enabled: Boolean(record.enabled),
    routeKey:
      typeof record.routeKey === "string" && record.routeKey.trim()
        ? record.routeKey.trim()
        : null,
    route: {
      serverName:
        typeof route.serverName === "string" ? route.serverName : "srv0",
      hosts: typeof route.hosts === "string" ? route.hosts : "",
      paths: typeof route.paths === "string" ? route.paths : "",
      handlerKind:
        route.handlerKind === "reverse_proxy" ||
        route.handlerKind === "file_server" ||
        route.handlerKind === "respond"
          ? route.handlerKind
          : "reverse_proxy",
      upstreamDial:
        typeof route.upstreamDial === "string" ? route.upstreamDial : "",
      fileRoot: typeof route.fileRoot === "string" ? route.fileRoot : "",
      respondBody:
        typeof route.respondBody === "string" ? route.respondBody : "",
      respondStatus:
        typeof route.respondStatus === "string" ? route.respondStatus : "200",
    },
  };
}

export function parseProjectCaddyConfig(
  raw: string | null | undefined,
): ProjectCaddyConfig {
  if (!raw?.trim()) {
    return { managed: null, linkedRouteKeys: [] };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { managed: null, linkedRouteKeys: [] };
    }

    const record = parsed as Record<string, unknown>;

    if ("managed" in record || "linkedRouteKeys" in record) {
      const managed =
        record.managed && typeof record.managed === "object"
          ? parseLegacyManagedSettings(record.managed as Record<string, unknown>)
          : null;
      const linkedRouteKeys = Array.isArray(record.linkedRouteKeys)
        ? [
            ...new Set(
              record.linkedRouteKeys
                .filter((key): key is string => typeof key === "string")
                .map((key) => key.trim())
                .filter(Boolean),
            ),
          ]
        : [];
      return { managed, linkedRouteKeys };
    }

    const legacy = parseLegacyManagedSettings(record);
    return { managed: legacy, linkedRouteKeys: [] };
  } catch {
    return { managed: null, linkedRouteKeys: [] };
  }
}

export function serializeProjectCaddyConfig(
  config: ProjectCaddyConfig,
): string | null {
  const linkedRouteKeys = [
    ...new Set(config.linkedRouteKeys.map((key) => key.trim()).filter(Boolean)),
  ];
  const managed = config.managed;

  if (!managed && linkedRouteKeys.length === 0) {
    return null;
  }

  return JSON.stringify({ managed, linkedRouteKeys });
}

export function serializeProjectCaddy(
  settings: ProjectCaddySettings | null,
): string | null {
  return serializeProjectCaddyConfig({
    managed: settings,
    linkedRouteKeys: [],
  });
}

export function hostsFromRouteForm(route: RouteFormValues): string[] {
  return route.hosts
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function hostsFromManagedRoute(
  settings: ProjectCaddySettings | null,
): string[] {
  if (!settings?.enabled) return [];
  return hostsFromRouteForm(settings.route);
}

export function resolveRoutesByKeys(
  keys: string[],
  allRoutes: ParsedRoute[],
): ParsedRoute[] {
  const byKey = new Map(allRoutes.map((route) => [route.key, route]));
  return keys
    .map((key) => byKey.get(key))
    .filter((route): route is ParsedRoute => route !== undefined);
}

export function collectProjectLogHosts(
  managed: ProjectCaddySettings | null,
  linkedRoutes: ParsedRoute[],
): string[] {
  const hosts = new Set<string>();
  for (const host of hostsFromManagedRoute(managed)) {
    hosts.add(host);
  }
  for (const route of linkedRoutes) {
    for (const host of route.hosts) {
      hosts.add(host.toLowerCase());
    }
  }
  return [...hosts];
}

export function routeDisplayLabel(route: ParsedRoute): string {
  const hosts = route.hosts.length > 0 ? route.hosts.join(", ") : "any host";
  const paths = route.paths.length > 0 ? route.paths.join(", ") : "any path";
  return `${hosts} → ${paths}`;
}

function findRouteByKey(
  config: unknown,
  routeKey: string,
): ParsedRoute | null {
  return parseHttpRoutes(config).find((route) => route.key === routeKey) ?? null;
}

function findRouteByProjectId(
  config: unknown,
  projectId: string,
): ParsedRoute | null {
  const storageKey = projectRouteStorageKey(projectId);
  return (
    parseHttpRoutes(config).find((route) => route.key === storageKey) ?? null
  );
}

function locateManagedRoute(
  config: unknown,
  projectId: string,
  settings: ProjectCaddySettings | null,
): ParsedRoute | null {
  if (settings?.routeKey) {
    const byKey = findRouteByKey(config, settings.routeKey);
    if (byKey) return byKey;
  }
  return findRouteByProjectId(config, projectId);
}

export function syncProjectRouteInConfig(
  config: unknown,
  projectId: string,
  settings: ProjectCaddySettings | null,
  hostPort: number | null,
): { config: Record<string, unknown>; settings: ProjectCaddySettings | null } {
  const existing = locateManagedRoute(config, projectId, settings);

  if (!settings?.enabled) {
    if (!existing) {
      return { config: structuredClone(config) as Record<string, unknown>, settings };
    }
    const next = removeRouteFromConfig(
      config,
      existing.serverName,
      existing.index,
      existing.subroute,
    );
    return { config: next, settings: null };
  }

  const routeValues = applyHostPortToRoute(settings.route, hostPort);
  const validationError = validateRouteForm(routeValues);
  if (validationError) {
    throw new Error(validationError);
  }

  const next = upsertRouteInConfig(config, routeValues, existing ?? undefined);
  const syncedRoute =
    findRouteByKey(next, settings.routeKey ?? "") ??
    findRouteByProjectId(next, projectId) ??
    parseHttpRoutes(next).find((route) => {
      if (existing && route.key === existing.key) return true;
      if (route.handlerKind !== routeValues.handlerKind) return false;
      if (routeValues.handlerKind === "reverse_proxy") {
        return route.upstreamDial === routeValues.upstreamDial.trim();
      }
      return false;
    }) ??
    null;

  return {
    config: next,
    settings: {
      enabled: true,
      route: routeValues,
      routeKey: syncedRoute?.key ?? settings.routeKey,
    },
  };
}
