import { getCaddyLogTcpAddress } from "@/lib/caddy-log-env";

export type RouteHandlerKind =
  | "reverse_proxy"
  | "file_server"
  | "respond"
  | "unknown";

export interface SubrouteLocation {
  parentRouteIndex: number;
  /** Indices into nested subroute.routes arrays from outermost to innermost. */
  path: number[];
  inheritedHosts: string[];
  inheritedPaths: string[];
}

export interface ParsedRoute {
  key: string;
  serverName: string;
  index: number;
  hosts: string[];
  paths: string[];
  /** Matchers defined on this route level only (excludes inherited subroute matchers). */
  ownHosts: string[];
  ownPaths: string[];
  handlerKind: RouteHandlerKind;
  upstreamDial?: string;
  fileRoot?: string;
  respondBody?: string;
  respondStatus?: number;
  subroute?: SubrouteLocation;
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

export type CaddyLogFormat = "json" | "console";
export type CaddyLogOutput = "file" | "stdout" | "stderr" | "forge";

export interface ServerLoggingFormValues {
  enabled: boolean;
  output: CaddyLogOutput;
  filePath: string;
  format: CaddyLogFormat;
}

const FORGE_LOG_PREFIX = "forge-";

export function forgeLogConfigKey(serverName: string): string {
  return `${FORGE_LOG_PREFIX}${serverName}`;
}

export function forgeAccessLoggerInclude(serverName: string): string {
  return `http.log.access.${forgeLogConfigKey(serverName)}`;
}

function isCaddyLogOutput(value: string): value is CaddyLogOutput {
  return (
    value === "file" ||
    value === "stdout" ||
    value === "stderr" ||
    value === "forge"
  );
}

function isForgeTcpAddress(address: string): boolean {
  return address === getCaddyLogTcpAddress();
}

function defaultServerLoggingFormValues(): ServerLoggingFormValues {
  return {
    enabled: false,
    output: "forge",
    filePath: "/var/log/caddy/access.log",
    format: "json",
  };
}

function findLogEntryForAccessLogger(
  logs: Record<string, unknown> | null,
  loggerName: string,
): Record<string, unknown> | null {
  if (!logs) return null;

  const includeTarget = `http.log.access.${loggerName}`;
  for (const entry of Object.values(logs)) {
    const record = asRecord(entry);
    const includes = asStringArray(record?.include);
    if (
      includes.includes(includeTarget) ||
      (loggerName === "" && includes.includes("http.log.access"))
    ) {
      return record;
    }
  }
  return null;
}

function ensureDefaultExcludesAccessLogger(
  logs: Record<string, unknown>,
  includeLogger: string,
): void {
  const defaultLog = asRecord(logs.default) ?? {};
  const exclude = asStringArray(defaultLog.exclude);
  if (exclude.includes(includeLogger)) return;
  defaultLog.exclude = [...exclude, includeLogger];
  logs.default = defaultLog;
}

function removeDefaultExclude(
  logs: Record<string, unknown>,
  includeLogger: string,
): void {
  const defaultLog = asRecord(logs.default);
  if (!defaultLog) return;

  const exclude = asStringArray(defaultLog.exclude).filter(
    (item) => item !== includeLogger,
  );
  if (exclude.length > 0) {
    defaultLog.exclude = exclude;
    logs.default = defaultLog;
    return;
  }

  delete defaultLog.exclude;
  if (Object.keys(defaultLog).length === 0) {
    delete logs.default;
  }
}

export function parseServerLogging(
  config: unknown,
  serverName: string,
): ServerLoggingFormValues {
  const defaults = defaultServerLoggingFormValues();
  const root = asRecord(config) ?? {};
  const server = asRecord(
    asRecord(asRecord(asRecord(root.apps)?.http)?.servers)?.[serverName],
  );
  if (!server || server.logs === undefined || server.logs === null) {
    return defaults;
  }

  const serverLogs = asRecord(server.logs) ?? {};
  const forgeKey = forgeLogConfigKey(serverName);
  const loggerName =
    typeof serverLogs.default_logger_name === "string"
      ? serverLogs.default_logger_name
      : forgeKey;

  const logging = asRecord(root.logging);
  const logs = asRecord(logging?.logs);
  const logEntry =
    asRecord(logs?.[forgeKey]) ??
    asRecord(logs?.[loggerName]) ??
    findLogEntryForAccessLogger(logs, loggerName);

  const result: ServerLoggingFormValues = {
    enabled: true,
    output: "stderr",
    filePath: defaults.filePath,
    format: "json",
  };

  if (!logEntry) {
    return result;
  }

  const writer = asRecord(logEntry.writer);
  const encoder = asRecord(logEntry.encoder);
  const output =
    typeof writer?.output === "string" ? writer.output : "stderr";

  if (output === "net") {
    const address = typeof writer?.address === "string" ? writer.address : "";
    result.output = isForgeTcpAddress(address) ? "forge" : "stderr";
  } else {
    result.output = isCaddyLogOutput(output) ? output : "stderr";
  }

  if (result.output === "file" && typeof writer?.filename === "string") {
    result.filePath = writer.filename;
  }

  const format = typeof encoder?.format === "string" ? encoder.format : "json";
  result.format = format === "console" ? "console" : "json";
  return result;
}

export function parseAllServerLogging(
  config: unknown,
): Record<string, ServerLoggingFormValues> {
  const logging: Record<string, ServerLoggingFormValues> = {};
  for (const server of listHttpServers(config)) {
    logging[server.name] = parseServerLogging(config, server.name);
  }
  return logging;
}

export function applyServerLogging(
  config: unknown,
  serverName: string,
  values: ServerLoggingFormValues,
): Record<string, unknown> {
  const next = structuredClone(asRecord(config) ?? {}) as Record<string, unknown>;
  ensureHttpServer(next, serverName);

  const forgeKey = forgeLogConfigKey(serverName);
  const includeLogger = forgeAccessLoggerInclude(serverName);

  const apps = asRecord(next.apps)!;
  const http = asRecord(apps.http)!;
  const servers = asRecord(http.servers)!;
  const server = asRecord(servers[serverName])!;

  const logging = asRecord(next.logging) ?? {};
  const logs = asRecord(logging.logs) ?? {};

  delete logs[forgeKey];
  removeDefaultExclude(logs, includeLogger);

  const existingLogs = asRecord(server.logs);
  if (existingLogs?.default_logger_name === forgeKey) {
    delete server.logs;
  }

  if (values.enabled) {
    server.logs = {
      default_logger_name: forgeKey,
    };

    const writer: Record<string, unknown> = (() => {
      switch (values.output) {
        case "file":
          return { output: "file", filename: values.filePath.trim() };
        case "forge":
          return { output: "net", address: getCaddyLogTcpAddress() };
        case "stdout":
        case "stderr":
          return { output: values.output };
        default: {
          const _exhaustive: never = values.output;
          return _exhaustive;
        }
      }
    })();

    const format = values.output === "forge" ? "json" : values.format;

    logs[forgeKey] = {
      include: [includeLogger],
      writer,
      encoder: { format },
    };
    ensureDefaultExcludesAccessLogger(logs, includeLogger);
  }

  if (Object.keys(logs).length > 0) {
    logging.logs = logs;
    next.logging = logging;
  } else {
    delete logging.logs;
    if (Object.keys(logging).length === 0) {
      delete next.logging;
    } else {
      next.logging = logging;
    }
  }

  return next;
}

export function applyAllServerLogging(
  config: unknown,
  valuesByServer: Record<string, ServerLoggingFormValues>,
): Record<string, unknown> {
  let next = structuredClone(asRecord(config) ?? {}) as Record<string, unknown>;
  for (const [serverName, values] of Object.entries(valuesByServer)) {
    next = applyServerLogging(next, serverName, values);
  }
  return next;
}

export function validateServerLogging(
  values: ServerLoggingFormValues,
): string | null {
  if (!values.enabled) return null;
  if (values.output === "file" && !values.filePath.trim()) {
    return "Log file path is required when output is file";
  }
  return null;
}

export function defaultServerLoggingForServer(
  serverName: string,
): ServerLoggingFormValues {
  return {
    ...defaultServerLoggingFormValues(),
    filePath:
      serverName === "srv0"
        ? "/var/log/caddy/access.log"
        : `/var/log/caddy/${serverName}-access.log`,
  };
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

function mergeMatchers(
  inheritedHosts: string[],
  inheritedPaths: string[],
  ownHosts: string[],
  ownPaths: string[],
): { hosts: string[]; paths: string[] } {
  const hosts =
    inheritedHosts.length > 0 && ownHosts.length > 0
      ? [...new Set([...inheritedHosts, ...ownHosts])]
      : inheritedHosts.length > 0
        ? inheritedHosts
        : ownHosts;
  const paths =
    inheritedPaths.length > 0 && ownPaths.length > 0
      ? [...new Set([...inheritedPaths, ...ownPaths])]
      : inheritedPaths.length > 0
        ? inheritedPaths
        : ownPaths;
  return { hosts, paths };
}

function readRouteMatchers(route: unknown): {
  hosts: string[];
  paths: string[];
} {
  const record = asRecord(route) ?? {};
  const match = Array.isArray(record.match) ? record.match : [];
  const firstMatch = asRecord(match[0]) ?? {};
  return {
    hosts: asStringArray(firstMatch.host),
    paths: asStringArray(firstMatch.path),
  };
}

function readSubrouteHandler(
  handle: unknown,
): Record<string, unknown> | null {
  if (!Array.isArray(handle) || handle.length === 0) return null;
  const first = asRecord(handle[0]);
  if (!first || first.handler !== "subroute") return null;
  return first;
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

function subrouteKey(
  serverName: string,
  parentRouteIndex: number,
  path: number[],
): string {
  return `${serverName}:${parentRouteIndex}:sub:${path.join(":")}`;
}

function parseLeafRoute(
  serverName: string,
  index: number,
  route: unknown,
  subroute?: SubrouteLocation,
): ParsedRoute {
  const { hosts: ownHosts, paths: ownPaths } = readRouteMatchers(route);
  const inheritedHosts = subroute?.inheritedHosts ?? [];
  const inheritedPaths = subroute?.inheritedPaths ?? [];
  const combined = mergeMatchers(
    inheritedHosts,
    inheritedPaths,
    ownHosts,
    ownPaths,
  );
  const record = asRecord(route) ?? {};

  return {
    key: subroute
      ? subrouteKey(serverName, subroute.parentRouteIndex, subroute.path)
      : `${serverName}:${index}`,
    serverName,
    index: subroute?.parentRouteIndex ?? index,
    hosts: combined.hosts,
    paths: combined.paths,
    ownHosts,
    ownPaths,
    subroute,
    ...readHandlerKind(record.handle),
  };
}

function expandSubrouteChildren(
  serverName: string,
  parentRouteIndex: number,
  childRoutes: unknown[],
  inheritedHosts: string[],
  inheritedPaths: string[],
  pathPrefix: number[] = [],
): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  childRoutes.forEach((childRoute, childIndex) => {
    const childRecord = asRecord(childRoute) ?? {};
    const path = [...pathPrefix, childIndex];
    const { hosts: childHosts, paths: childPaths } = readRouteMatchers(childRoute);
    const nextInheritedHosts =
      childHosts.length > 0 ? childHosts : inheritedHosts;
    const nextInheritedPaths =
      childPaths.length > 0 ? childPaths : inheritedPaths;

    const nestedSubroute = readSubrouteHandler(childRecord.handle);
    if (nestedSubroute) {
      const nestedRoutes = Array.isArray(nestedSubroute.routes)
        ? nestedSubroute.routes
        : [];
      routes.push(
        ...expandSubrouteChildren(
          serverName,
          parentRouteIndex,
          nestedRoutes,
          nextInheritedHosts,
          nextInheritedPaths,
          path,
        ),
      );
      return;
    }

    routes.push(
      parseLeafRoute(serverName, parentRouteIndex, childRoute, {
        parentRouteIndex,
        path,
        inheritedHosts,
        inheritedPaths,
      }),
    );
  });

  return routes;
}

function expandRoute(
  serverName: string,
  index: number,
  route: unknown,
  inheritedHosts: string[] = [],
  inheritedPaths: string[] = [],
): ParsedRoute[] {
  const record = asRecord(route) ?? {};
  const { hosts: routeHosts, paths: routePaths } = readRouteMatchers(route);
  const nextInheritedHosts =
    routeHosts.length > 0 ? routeHosts : inheritedHosts;
  const nextInheritedPaths =
    routePaths.length > 0 ? routePaths : inheritedPaths;

  const subrouteHandler = readSubrouteHandler(record.handle);
  if (!subrouteHandler) {
    return [parseLeafRoute(serverName, index, route, undefined)];
  }

  const childRoutes = Array.isArray(subrouteHandler.routes)
    ? subrouteHandler.routes
    : [];

  if (childRoutes.length === 0) {
    return [
      {
        key: `${serverName}:${index}`,
        serverName,
        index,
        hosts: nextInheritedHosts,
        paths: nextInheritedPaths,
        ownHosts: routeHosts,
        ownPaths: routePaths,
        handlerKind: "unknown",
      },
    ];
  }

  return expandSubrouteChildren(
    serverName,
    index,
    childRoutes,
    nextInheritedHosts,
    nextInheritedPaths,
  );
}

export function parseRoute(
  serverName: string,
  index: number,
  route: unknown,
): ParsedRoute {
  return expandRoute(serverName, index, route)[0] ?? {
    key: `${serverName}:${index}`,
    serverName,
    index,
    hosts: [],
    paths: [],
    ownHosts: [],
    ownPaths: [],
    handlerKind: "unknown",
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
      routes.push(...expandRoute(serverName, index, route));
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

function buildChildRouteObject(
  values: RouteFormValues,
  inheritedHosts: string[],
  inheritedPaths: string[],
): Record<string, unknown> {
  const hosts = splitCsv(values.hosts);
  const paths = splitCsv(values.paths);

  const ownHosts = inheritedHosts.length
    ? hosts.filter((host) => !inheritedHosts.includes(host))
    : hosts;
  const ownPaths = inheritedPaths.length
    ? paths.filter((path) => !inheritedPaths.includes(path))
    : paths;

  return buildRouteObject({
    ...values,
    hosts: ownHosts.join(", "),
    paths: ownPaths.join(", "),
  });
}

function getSubrouteChildRoutes(
  parentRoute: Record<string, unknown>,
): Record<string, unknown>[] {
  const subrouteHandler = readSubrouteHandler(parentRoute.handle);
  if (!subrouteHandler) return [];
  return Array.isArray(subrouteHandler.routes)
    ? [...(subrouteHandler.routes as Record<string, unknown>[])]
    : [];
}

function getSubrouteRoutesAtPath(
  parentRoute: Record<string, unknown>,
  path: number[],
): Record<string, unknown>[] | null {
  if (path.length === 0) return getSubrouteChildRoutes(parentRoute);

  const [head, ...tail] = path;
  const childRoutes = getSubrouteChildRoutes(parentRoute);
  const child = asRecord(childRoutes[head]);
  if (!child) return null;

  if (tail.length === 0) {
    return getSubrouteChildRoutes(child);
  }

  return getSubrouteRoutesAtPath(child, tail);
}

function setSubrouteRoutesAtPath(
  parentRoute: Record<string, unknown>,
  path: number[],
  routes: Record<string, unknown>[],
): boolean {
  if (path.length === 0) {
    setSubrouteChildRoutes(parentRoute, routes);
    return true;
  }

  const [head, ...tail] = path;
  const childRoutes = getSubrouteChildRoutes(parentRoute);
  const child = asRecord(childRoutes[head]);
  if (!child) return false;

  if (tail.length === 0) {
    setSubrouteChildRoutes(child, routes);
    childRoutes[head] = child;
    setSubrouteChildRoutes(parentRoute, childRoutes);
    return true;
  }

  if (!setSubrouteRoutesAtPath(child, tail, routes)) return false;
  childRoutes[head] = child;
  setSubrouteChildRoutes(parentRoute, childRoutes);
  return true;
}

function setSubrouteChildRoutes(
  parentRoute: Record<string, unknown>,
  childRoutes: Record<string, unknown>[],
): void {
  const subrouteHandler = readSubrouteHandler(parentRoute.handle);
  if (!subrouteHandler) return;
  subrouteHandler.routes = childRoutes;
}

export function upsertRouteInConfig(
  config: unknown,
  values: RouteFormValues,
  existing?: Pick<ParsedRoute, "serverName" | "index" | "subroute">,
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

  if (existing?.subroute) {
    const parentIndex = existing.subroute.parentRouteIndex;
    if (parentIndex < 0 || parentIndex >= routes.length) {
      routes.push(buildRouteObject(values));
      server.routes = routes;
      return next;
    }

    const parentRoute = asRecord(routes[parentIndex]);
    if (!parentRoute) {
      routes.push(buildRouteObject(values));
      server.routes = routes;
      return next;
    }

    const path = existing.subroute.path;
    const parentPath = path.slice(0, -1);
    const childIndex = path[path.length - 1];
    const childRoutes =
      getSubrouteRoutesAtPath(parentRoute, parentPath) ??
      getSubrouteChildRoutes(parentRoute);
    const routeObject = buildChildRouteObject(
      values,
      existing.subroute.inheritedHosts,
      existing.subroute.inheritedPaths,
    );

    if (childIndex >= 0 && childIndex < childRoutes.length) {
      childRoutes[childIndex] = routeObject;
    } else {
      childRoutes.push(routeObject);
    }

    if (parentPath.length === 0) {
      setSubrouteChildRoutes(parentRoute, childRoutes);
    } else {
      setSubrouteRoutesAtPath(parentRoute, parentPath, childRoutes);
    }
    routes[parentIndex] = parentRoute;
    server.routes = routes;
    return next;
  }

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
  subroute?: SubrouteLocation,
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

  if (subroute) {
    const parentIndex = subroute.parentRouteIndex;
    if (parentIndex < 0 || parentIndex >= routes.length) return next;

    const parentRoute = asRecord(routes[parentIndex]);
    if (!parentRoute) return next;

    const path = subroute.path;
    const parentPath = path.slice(0, -1);
    const childIndex = path[path.length - 1];
    const childRoutes =
      getSubrouteRoutesAtPath(parentRoute, parentPath) ??
      getSubrouteChildRoutes(parentRoute);
    if (childIndex < 0 || childIndex >= childRoutes.length) return next;

    childRoutes.splice(childIndex, 1);

    if (childRoutes.length === 0) {
      if (parentPath.length === 0) {
        routes.splice(parentIndex, 1);
      } else {
        setSubrouteRoutesAtPath(parentRoute, parentPath, childRoutes);
        routes[parentIndex] = parentRoute;
      }
    } else if (parentPath.length === 0) {
      setSubrouteChildRoutes(parentRoute, childRoutes);
      routes[parentIndex] = parentRoute;
    } else {
      setSubrouteRoutesAtPath(parentRoute, parentPath, childRoutes);
      routes[parentIndex] = parentRoute;
    }
    server.routes = routes;
    return next;
  }

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
    hosts: route.ownHosts.join(", "),
    paths: route.ownPaths.join(", "),
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

export function validateRouteForm(
  values: RouteFormValues,
  inherited?: Pick<SubrouteLocation, "inheritedHosts" | "inheritedPaths">,
): string | null {
  if (!values.serverName.trim()) return "Server name is required";

  const hosts = splitCsv(values.hosts);
  const paths = splitCsv(values.paths);
  const inheritedHosts = inherited?.inheritedHosts ?? [];
  const inheritedPaths = inherited?.inheritedPaths ?? [];

  if (
    hosts.length + paths.length + inheritedHosts.length + inheritedPaths.length ===
    0
  ) {
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
