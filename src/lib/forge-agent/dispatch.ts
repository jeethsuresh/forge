import { authenticateOpsRequest, type OpsAuth } from "@/lib/ops-api-auth";
import { denyIfBootstrapRestricted, isBootstrapOpsPathAllowed } from "@/lib/ops-bootstrap-guard";
import {
  getForgeAgentResource,
  getForgeAgentTool,
  listForgeAgentResources,
} from "@/lib/forge-agent/registry";
import type { ForgeAgentNext, ForgeAgentTool } from "@/lib/forge-agent/types";
import { forgeAgentEnvelope } from "@/lib/forge-agent/envelope";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

function dashboardDenied(tool: ForgeAgentTool): Response {
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
  return jsonResponse(
    forgeAgentEnvelope({
      self: `/api/ops/tools/${tool.name}/call`,
      next,
      extra: {
        error: "This tool requires a dashboard cookie session and is not callable with an Ops token.",
        callable: false,
        auth: "dashboard_cookie",
      },
    }),
    403,
  );
}

export function denyDashboardOrUncallable(tool: ForgeAgentTool): Response | null {
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

  return fetch(url, init);
}

export function denyBootstrapForTarget(
  auth: OpsAuth,
  tool: ForgeAgentTool,
  args: Record<string, unknown>,
): Response | null {
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

function requireCallAuth(request: Request): OpsAuth | Response {
  const auth = authenticateOpsRequest(request);
  if (!auth) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return auth;
}

export async function callForgeAgentTool(input: {
  name: string;
  args: Record<string, unknown>;
  request: Request;
}): Promise<Response> {
  const tool = getForgeAgentTool(input.name);
  if (!tool) {
    return jsonResponse(
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
      404,
    );
  }

  const dashboard = denyDashboardOrUncallable(tool);
  if (dashboard) return dashboard;

  const invalid = validateToolArguments(tool, input.args);
  if (invalid) {
    return jsonResponse({ error: invalid }, 400);
  }

  const auth = requireCallAuth(input.request);
  if (auth instanceof Response) return auth;

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
    return jsonResponse({ error: `Unknown resource: ${input.nameOrUri}` }, 404);
  }

  if (resource.kind === "dashboard" || resource.auth === "dashboard_cookie") {
    return jsonResponse(
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
      403,
    );
  }

  if (resource.kind === "git") {
    const slug = String(input.args.slug ?? extractUriArg(input.nameOrUri, "slug") ?? "");
    return jsonResponse(
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
    return jsonResponse({ resource });
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
