import { NextResponse } from "next/server";
import { isBootstrapOpsPathAllowed } from "@/lib/ops-bootstrap-guard";
import {
  denyIfBootstrapRestricted,
  requireOpsAuth,
  type OpsAuth,
} from "@/lib/ops-api-route";
import {
  getForgeAgentResource,
  getForgeAgentTool,
  listForgeAgentResources,
} from "@/lib/forge-agent/registry";
import type { ForgeAgentNext, ForgeAgentTool } from "@/lib/forge-agent/types";
import { forgeAgentEnvelope } from "@/lib/forge-agent/envelope";

type RouteModule = {
  GET?: (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
  POST?: (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
  PATCH?: (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
};

type RouteLoader = () => Promise<RouteModule>;

const ROUTE_LOADERS: Record<string, RouteLoader> = {
  "GET /api/ops": () => import("@/app/api/ops/route"),
  "GET /api/ops/actions": () => import("@/app/api/ops/actions/route"),
  "GET /api/ops/projects": () => import("@/app/api/ops/projects/route"),
  "GET /api/ops/projects/{projectId}": () => import("@/app/api/ops/projects/[id]/route"),
  "PATCH /api/ops/projects/{projectId}": () => import("@/app/api/ops/projects/[id]/route"),
  "GET /api/ops/projects/{projectId}/forgefile": () =>
    import("@/app/api/ops/projects/[id]/forgefile/route"),
  "GET /api/ops/services": () => import("@/app/api/ops/services/route"),
  "GET /api/ops/projects/{projectId}/artifacts": () =>
    import("@/app/api/ops/projects/[id]/artifacts/route"),
  "POST /api/ops/projects/{projectId}/artifacts/{name}/build": () =>
    import("@/app/api/ops/projects/[id]/artifacts/[name]/build/route"),
  "GET /api/ops/projects/{projectId}/artifacts/{name}/builds/{buildId}/download": () =>
    import("@/app/api/ops/projects/[id]/artifacts/[name]/builds/[buildId]/download/route"),
  "POST /api/ops/projects/{projectId}/scripts/{name}/run": () =>
    import("@/app/api/ops/projects/[id]/scripts/[name]/run/route"),
  "POST /api/ops/projects/{projectId}/deploy": () =>
    import("@/app/api/ops/projects/[id]/deploy/route"),
  "POST /api/ops/projects/{projectId}/rollback": () =>
    import("@/app/api/ops/projects/[id]/rollback/route"),
  "POST /api/ops/projects/{projectId}/stop": () =>
    import("@/app/api/ops/projects/[id]/stop/route"),
  "GET /api/ops/projects/{projectId}/deployments": () =>
    import("@/app/api/ops/projects/[id]/deployments/route"),
  "GET /api/ops/projects/{projectId}/deployments/{deploymentId}": () =>
    import("@/app/api/ops/projects/[id]/deployments/[deploymentId]/route"),
  "GET /api/ops/projects/{projectId}/agent-sessions": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/route"),
  "POST /api/ops/projects/{projectId}/agent-sessions": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/route"),
  "GET /api/ops/projects/{projectId}/agent-sessions/{sessionId}": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/[sessionId]/route"),
  "POST /api/ops/projects/{projectId}/agent-sessions/{sessionId}/messages": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/[sessionId]/messages/route"),
  "POST /api/ops/projects/{projectId}/agent-sessions/{sessionId}/stop": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/[sessionId]/stop/route"),
  "POST /api/ops/projects/{projectId}/agent-sessions/{sessionId}/end": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/[sessionId]/end/route"),
  "POST /api/ops/projects/{projectId}/agent-sessions/{sessionId}/restart": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/[sessionId]/restart/route"),
  "POST /api/ops/projects/{projectId}/agent-sessions/{sessionId}/heartbeat": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/[sessionId]/heartbeat/route"),
  "POST /api/ops/projects/{projectId}/agent-sessions/{sessionId}/events": () =>
    import("@/app/api/ops/projects/[id]/agent-sessions/[sessionId]/events/route"),
  "POST /api/ops/projects/{projectId}/secrets/{name}/request": () =>
    import("@/app/api/ops/projects/[id]/secrets/[name]/request/route"),
  "POST /api/ops/projects/{projectId}/git-tree/rebase/finalize": () =>
    import("@/app/api/ops/projects/[id]/git-tree/rebase/finalize/route"),
};

const PATH_PARAM_TO_ROUTE: Record<string, string> = {
  projectId: "id",
  sessionId: "sessionId",
  name: "name",
  deploymentId: "deploymentId",
  buildId: "buildId",
  slug: "slug",
};

export function expandToolPath(
  template: string,
  args: Record<string, unknown>,
): { path: string; used: string[] } {
  const used: string[] = [];
  const path = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = args[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Missing path parameter ${key}`);
    }
    used.push(key);
    return encodeURIComponent(value.trim());
  });
  return { path, used };
}

export function validateToolArguments(
  tool: ForgeAgentTool,
  args: Record<string, unknown>,
): string | null {
  for (const key of tool.inputSchema.required ?? []) {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      return `Missing required argument: ${key}`;
    }
  }
  return null;
}

function remainingArgs(
  args: Record<string, unknown>,
  used: string[],
): Record<string, unknown> {
  const skip = new Set(used);
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!skip.has(key) && value !== undefined) rest[key] = value;
  }
  return rest;
}

function routeParams(args: Record<string, unknown>, used: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of used) {
    const routeKey = PATH_PARAM_TO_ROUTE[key] ?? key;
    params[routeKey] = String(args[key]);
  }
  return params;
}

function dashboardDenied(tool: ForgeAgentTool): NextResponse {
  const next: ForgeAgentNext[] = [
    {
      method: "GET",
      href: tool.path,
      description: "This surface requires a logged-in dashboard cookie session.",
      auth: "dashboard_cookie",
    },
    {
      method: "GET",
      href: "/api/ops/search?q=ops.",
      description: "Search Ops-callable tools instead",
      auth: "none",
    },
  ];
  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/tools/${tool.name}/call`,
      next,
      extra: {
        error: "This tool requires a dashboard cookie session and is not callable with an Ops token.",
        callable: false,
        auth: "dashboard_cookie",
      },
    }),
    { status: 403 },
  );
}

export function denyDashboardOrUncallable(tool: ForgeAgentTool): NextResponse | null {
  if (!tool.callable || tool.auth === "dashboard_cookie" || tool.kind === "dashboard") {
    return dashboardDenied(tool);
  }
  return null;
}

function copyAuthHeaders(from: Request): Headers {
  const headers = new Headers();
  for (const name of [
    "authorization",
    "x-forge-ops-token",
    "x-forge-agent-session-id",
    "content-type",
  ]) {
    const value = from.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

export async function invokeOpsTool(
  tool: ForgeAgentTool,
  args: Record<string, unknown>,
  incoming: Request,
): Promise<Response> {
  const { path, used } = expandToolPath(tool.path, args);
  const rest = remainingArgs(args, used);
  const url = new URL(path, incoming.url);
  if (tool.method === "GET") {
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const init: RequestInit = {
    method: tool.method,
    headers: copyAuthHeaders(incoming),
  };
  if (tool.method !== "GET" && tool.method !== "HEAD") {
    init.body = JSON.stringify(rest);
  }

  const forwarded = new Request(url, init);
  const loader = ROUTE_LOADERS[`${tool.method} ${tool.path}`];
  if (!loader) {
    return NextResponse.json(
      { error: `No dispatcher for ${tool.method} ${tool.path}` },
      { status: 500 },
    );
  }
  const mod = await loader();
  const handler = mod[tool.method as "GET" | "POST" | "PATCH"];
  if (!handler) {
    return NextResponse.json(
      { error: `Handler ${tool.method} missing for ${tool.path}` },
      { status: 500 },
    );
  }
  return handler(forwarded, { params: Promise.resolve(routeParams(args, used)) });
}

export function requireOpsAuthForCall(request: Request): OpsAuth | NextResponse {
  return requireOpsAuth(request);
}

export function denyBootstrapForTarget(
  auth: OpsAuth,
  tool: ForgeAgentTool,
  args: Record<string, unknown>,
): NextResponse | null {
  if (auth.kind !== "session") return null;
  let path: string;
  try {
    path = expandToolPath(tool.path, args).path;
  } catch {
    return null;
  }
  if (isBootstrapOpsPathAllowed(tool.method, path)) return null;
  const fake = new Request(new URL(path, "http://127.0.0.1"), { method: tool.method });
  return denyIfBootstrapRestricted(auth, fake);
}

export async function callForgeAgentTool(input: {
  name: string;
  args: Record<string, unknown>;
  request: Request;
}): Promise<Response> {
  const tool = getForgeAgentTool(input.name);
  if (!tool) {
    return NextResponse.json(
      forgeAgentEnvelope({
        self: `/api/ops/tools/${input.name}/call`,
        next: [
          {
            method: "GET",
            href: "/api/ops/search?q=",
            description: "Search for a known tool name",
            auth: "none",
          },
        ],
        extra: { error: `Unknown tool: ${input.name}` },
      }),
      { status: 404 },
    );
  }

  const dashboard = denyDashboardOrUncallable(tool);
  if (dashboard) return dashboard;

  const invalid = validateToolArguments(tool, input.args);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const auth = requireOpsAuthForCall(input.request);
  if (auth instanceof NextResponse) return auth;

  const bootstrap = denyBootstrapForTarget(auth, tool, input.args);
  if (bootstrap) return bootstrap;

  return invokeOpsTool(tool, input.args, input.request);
}

export async function readForgeAgentResource(input: {
  nameOrUri: string;
  args: Record<string, unknown>;
  request: Request;
}): Promise<Response> {
  const byName = getForgeAgentResource(input.nameOrUri);
  const byUri = listResourceByUri(input.nameOrUri);
  const resource = byName ?? byUri;
  if (!resource) {
    return NextResponse.json({ error: `Unknown resource: ${input.nameOrUri}` }, { status: 404 });
  }

  if (resource.kind === "dashboard" || resource.auth === "dashboard_cookie") {
    return NextResponse.json(
      forgeAgentEnvelope({
        self: `/api/ops/resources/${resource.name}`,
        next: [
          {
            method: "GET",
            href: resource.uriTemplate.replace("forge://dashboard", "/api"),
            description: "Open this surface in the dashboard with a cookie session",
            auth: "dashboard_cookie",
          },
        ],
        extra: {
          error: "Dashboard resource; Ops tokens cannot read live data.",
          auth: "dashboard_cookie",
        },
      }),
      { status: 403 },
    );
  }

  if (resource.kind === "git") {
    const slug = String(input.args.slug ?? extractUriArg(input.nameOrUri, "slug") ?? "");
    return NextResponse.json(
      forgeAgentEnvelope({
        self: `/api/ops/resources/${resource.name}`,
        next: [
          {
            method: "GET",
            href: slug ? `/api/git/${slug}.git/info/refs` : "/api/git/{slug}.git/info/refs",
            description: "Smart HTTP advertise (Ops/session token)",
            auth: "ops",
          },
        ],
        extra: {
          uri: slug ? `forge://git/${slug}` : resource.uriTemplate,
          advertise: slug ? `/api/git/${slug}.git/info/refs` : "/api/git/{slug}.git/info/refs",
          clone: slug ? `/api/git/${slug}.git` : "/api/git/{slug}.git",
          docs: "docs/git-server.md",
        },
      }),
    );
  }

  if (!resource.live || !resource.readTool) {
    return NextResponse.json({ resource }, { status: 200 });
  }

  return callForgeAgentTool({
    name: resource.readTool,
    args: input.args,
    request: input.request,
  });
}

function listResourceByUri(uri: string) {
  const resources = listForgeAgentResources();
  const exact = resources.find((item) => item.uriTemplate === uri);
  if (exact) return exact;
  return resources
    .filter((item) => item.uriTemplate.includes("{"))
    .sort((a, b) => b.uriTemplate.length - a.uriTemplate.length)
    .find((item) => {
      const prefix = item.uriTemplate.split("{")[0] ?? "";
      return prefix.length > 0 && uri.startsWith(prefix);
    });
}

function extractUriArg(uri: string, key: string): string | undefined {
  if (key === "slug" && uri.startsWith("forge://git/")) {
    return uri.slice("forge://git/".length).split("/")[0];
  }
  const parts = uri.replace("forge://ops/projects/", "").split("/");
  if (key === "projectId") return parts[0];
  if (key === "deploymentId") return parts[2];
  return undefined;
}
