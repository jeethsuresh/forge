import { NextResponse } from "next/server";
import { forgeAgentEnvelope, forgeAgentSearchHref } from "@/lib/forge-agent/envelope";
import { searchableForgeAgentItems } from "@/lib/forge-agent/registry";
import { rankForgeAgentHits } from "@/lib/forge-agent/search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const hits = rankForgeAgentHits(q, searchableForgeAgentItems());
  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/search${url.search}`,
      search: forgeAgentSearchHref(q),
      next: [
        {
          method: "GET",
          href: "/api/ops/tools",
          description: "List all tool schemas",
          auth: "none",
        },
        {
          method: "POST",
          href: "/api/ops/mcp",
          description: "Call a tool via MCP JSON-RPC after authenticating",
          auth: "ops",
        },
      ],
      extra: { q, hits },
    }),
  );
}
