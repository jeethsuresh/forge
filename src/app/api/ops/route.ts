import { NextResponse } from "next/server";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";
import { forgeAgentEnvelope, forgeAgentSearchHref } from "@/lib/forge-agent/envelope";
import { rankForgeAgentHits } from "@/lib/forge-agent/search";
import { opsApiBaseUrl } from "@/lib/ops-api-auth";
import { requireOpsAuth } from "@/lib/ops-api-route";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const catalog = forgeOpsApiCatalog(opsApiBaseUrl());
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const endpoints = q
    ? rankForgeAgentHits(
        q,
        catalog.endpoints.map((endpoint) => ({
          kind: "tool" as const,
          name: `${endpoint.method} ${endpoint.path}`,
          description: endpoint.description,
          tags: [endpoint.method.toLowerCase()],
          path: endpoint.path,
        })),
      ).map((hit) => catalog.endpoints.find((endpoint) => `${endpoint.method} ${endpoint.path}` === hit.name)!)
    : catalog.endpoints;

  return NextResponse.json({
    ...catalog,
    endpoints,
    ...forgeAgentEnvelope({
      self: `/api/ops${url.search}`,
      search: forgeAgentSearchHref(q),
      next: [
        {
          method: "GET",
          href: "/api/ops/discover",
          description: "Public protocol bootstrap (no auth)",
          auth: "none",
        },
        {
          method: "GET",
          href: "/api/ops/tools",
          description: "Tool schemas for HTTP explorer and MCP",
          auth: "none",
        },
        {
          method: "POST",
          href: "/api/ops/mcp",
          description: "MCP JSON-RPC transport",
          auth: "none",
        },
      ],
    }),
  });
}
