import { NextResponse } from "next/server";
import { explorerCollectionNext, forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { listForgeAgentTools } from "@/lib/forge-agent/registry";
import { rankForgeAgentHits } from "@/lib/forge-agent/search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const tools = listForgeAgentTools();
  const filtered = q
    ? rankForgeAgentHits(q, tools.map((tool) => ({
        kind: "tool" as const,
        name: tool.name,
        description: tool.description,
        tags: tool.tags,
        path: tool.path,
        callable: tool.callable,
        auth: tool.auth,
      }))).map((hit) => tools.find((tool) => tool.name === hit.name)!)
    : tools;

  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/tools${url.search}`,
      next: [
        ...explorerCollectionNext("tools"),
        {
          method: "POST",
          href: "/api/ops/tools/{name}/call",
          description: "Call a callable tool (Ops bearer + actionDescription on mutations)",
          auth: "ops",
        },
      ],
      extra: { tools: filtered },
    }),
  );
}
