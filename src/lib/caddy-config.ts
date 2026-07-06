export type RouteHandlerKind =
  | "reverse_proxy"
  | "file_server"
  | "respond"
  | "unknown";

export interface ParsedRoute {
  key: string;
  serverName: string;
  index: number;
  hosts: string[];
  paths: string[];
  handlerKind: RouteHandlerKind;
  upstreamDial?: string;
  fileRoot?: string;
  respondBody?: string;
  respondStatus?: number;
}

export interface RouteFormValues {
  serverName: string;
  hosts: string;
  paths: string;
  handlerKind: Exclude<RouteHandlerKind, "unknown">;
  upstreamDial: string;
  fileRoot: string;
  respondBody: string;
  respondStatus: string;
}

export interface HttpServerSummary {
  name: string;
  listen: string[];
  routeCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readHandlerKind(
  handle: unknown,
): Pick<
  ParsedRoute,
  "handlerKind" | "upstreamDial" | "fileRoot" | "respondBody" | "respondStatus"
> {
  if (!Array.isArray(handle) || handle.length === 0) {
    return { handlerKind: "unknown" };
  }

  const first = asRecord(handle[0]);
  if (!first) return { handlerKind: "unknown" };

  const handler = first.handler;
  if (handler === "reverse_proxy") {
    const upstreams = first.upstreams;
    const dial =
      Array.isArray(upstreams) &&
      upstreams.length > 0 &&
      asRecord(upstreams[0])?.dial;
    return {
      handlerKind: "reverse_proxy",
      upstreamDial: typeof dial === "string" ? dial : "",
    };
  }

  if (handler === "file_server") {
    const root = first.root;
    return {
      handlerKind: "file_server",
      fileRoot: typeof root === "string" ? root : "",
    };
  }

  if (handler === "respond") {
    const body = first.body;
    const statusCode = first.status_code;
    return {
      handlerKind: "respond",
      respondBody: typeof body === "string" ? body : "",
      respondStatus:
        typeof statusCode === "number" ? statusCode : undefined,
    };
  }

  return { handlerKind: "unknown" };
}

export function parseRoute(
  serverName: string,
  index: number,
  route: unknown,
): ParsedRoute {
  const record = asRecord(route) ?? {};
  const match = Array.isArray(record.match) ? record.match : [];
  const firstMatch = asRecord(match[0]) ?? {};

  const hosts = asStringArray(firstMatch.host);
  const paths = asStringArray(firstMatch.path);

  return {
    key: `${serverName}:${index}`,
    serverName,
    index,
    hosts,
    paths,
    ...readHandlerKind(record.handle),
  };
}

export function listHttpServers(config: unknown): HttpServerSummary[] {
  const apps = asRecord(asRecord(config)?.apps);
  const http = asRecord(apps?.http);
  const servers = asRecord(http?.servers);
  if (!servers) return [];

  return Object.entries(servers).map(([name, server]) => {
    const serverRecord = asRecord(server) ?? {};
    const routes = Array.isArray(serverRecord.routes) ? serverRecord.routes : [];
    return {
      name,
      listen: asStringArray(serverRecord.listen),
      routeCount: routes.length,
    };
  });
}

export function parseHttpRoutes(config: unknown): ParsedRoute[] {
  const apps = asRecord(asRecord(config)?.apps);
  const http = asRecord(apps?.http);
  const servers = asRecord(http?.servers);
  if (!servers) return [];

  const routes: ParsedRoute[] = [];
  for (const [serverName, server] of Object.entries(servers)) {
    const serverRecord = asRecord(server) ?? {};
    const serverRoutes = Array.isArray(serverRecord.routes)
      ? serverRecord.routes
      : [];
    serverRoutes.forEach((route, index) => {
      routes.push(parseRoute(serverName, index, route));
    });
  }
  return routes;
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildRouteObject(values: RouteFormValues): Record<string, unknown> {
  const hosts = splitCsv(values.hosts);
  const paths = splitCsv(values.paths);

  const match: Record<string, unknown> = {};
  if (hosts.length > 0) match.host = hosts;
  if (paths.length > 0) match.path = paths;

  let handle: Record<string, unknown>;
  switch (values.handlerKind) {
    case "reverse_proxy":
      handle = {
        handler: "reverse_proxy",
        upstreams: [{ dial: values.upstreamDial.trim() }],
      };
      break;
    case "file_server":
      handle = {
        handler: "file_server",
        root: values.fileRoot.trim(),
      };
      break;
    case "respond": {
      const status = Number.parseInt(values.respondStatus, 10);
      handle = {
        handler: "respond",
        body: values.respondBody,
        ...(Number.isFinite(status) ? { status_code: status } : {}),
      };
      break;
    }
    default: {
      const _exhaustive: never = values.handlerKind;
      return _exhaustive;
    }
  }

  const route: Record<string, unknown> = { handle: [handle] };
  if (Object.keys(match).length > 0) {
    route.match = [match];
  }
  return route;
}

export function ensureHttpServer(
  config: Record<string, unknown>,
  serverName: string,
): Record<string, unknown> {
  const apps = asRecord(config.apps) ?? {};
  const http = asRecord(apps.http) ?? {};
  const servers = asRecord(http.servers) ?? {};

  if (!servers[serverName]) {
    servers[serverName] = {
      listen: [":80", ":443"],
      routes: [],
    };
  }

  http.servers = servers;
  apps.http = http;
  config.apps = apps;
  return config;
}

export function upsertRouteInConfig(
  config: unknown,
  values: RouteFormValues,
  existing?: Pick<ParsedRoute, "serverName" | "index">,
): Record<string, unknown> {
  const next = structuredClone(
    asRecord(config) ?? {},
  ) as Record<string, unknown>;
  ensureHttpServer(next, values.serverName);

  const apps = asRecord(next.apps)!;
  const http = asRecord(apps.http)!;
  const servers = asRecord(http.servers)!;
  const server = asRecord(servers[values.serverName])!;
  const routes = Array.isArray(server.routes)
    ? [...server.routes]
    : [];

  const routeObject = buildRouteObject(values);

  if (
    existing &&
    existing.serverName === values.serverName &&
    existing.index >= 0 &&
    existing.index < routes.length
  ) {
    routes[existing.index] = routeObject;
  } else {
    routes.push(routeObject);
  }

  server.routes = routes;
  return next;
}

export function removeRouteFromConfig(
  config: unknown,
  serverName: string,
  index: number,
): Record<string, unknown> {
  const next = structuredClone(
    asRecord(config) ?? {},
  ) as Record<string, unknown>;
  const apps = asRecord(next.apps);
  const http = asRecord(apps?.http);
  const servers = asRecord(http?.servers);
  const server = asRecord(servers?.[serverName]);
  if (!server || !Array.isArray(server.routes)) return next;

  const routes = [...server.routes];
  if (index < 0 || index >= routes.length) return next;
  routes.splice(index, 1);
  server.routes = routes;
  return next;
}

export function defaultRouteFormValues(serverName: string): RouteFormValues {
  return {
    serverName,
    hosts: "",
    paths: "",
    handlerKind: "reverse_proxy",
    upstreamDial: "127.0.0.1:8080",
    fileRoot: "/var/www",
    respondBody: "OK",
    respondStatus: "200",
  };
}

export function routeToFormValues(route: ParsedRoute): RouteFormValues {
  return {
    serverName: route.serverName,
    hosts: route.hosts.join(", "),
    paths: route.paths.join(", "),
    handlerKind:
      route.handlerKind === "unknown" ? "reverse_proxy" : route.handlerKind,
    upstreamDial: route.upstreamDial ?? "",
    fileRoot: route.fileRoot ?? "",
    respondBody: route.respondBody ?? "",
    respondStatus:
      route.respondStatus !== undefined
        ? String(route.respondStatus)
        : "200",
  };
}

export function validateRouteForm(values: RouteFormValues): string | null {
  if (!values.serverName.trim()) return "Server name is required";
  if (!splitCsv(values.hosts).length && !splitCsv(values.paths).length) {
    return "At least one host or path matcher is required";
  }

  switch (values.handlerKind) {
    case "reverse_proxy":
      if (!values.upstreamDial.trim()) return "Upstream dial address is required";
      return null;
    case "file_server":
      if (!values.fileRoot.trim()) return "File root path is required";
      return null;
    case "respond":
      if (!values.respondBody.trim()) return "Response body is required";
      return null;
    default: {
      const _exhaustive: never = values.handlerKind;
      return _exhaustive;
    }
  }
}
