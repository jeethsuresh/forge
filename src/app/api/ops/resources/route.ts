import { NextResponse } from "next/server";
import { explorerCollectionNext, forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { listForgeAgentResources } from "@/lib/forge-agent/registry";
import { rankForgeAgentHits } from "@/lib/forge-agent/search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const resources = listForgeAgentResources();
  const filtered = q
    ? rankForgeAgentHits(
        q,
        resources.map((item) => ({
          kind: "resource" as const,
          name: item.name,
          description: item.description,
          tags: item.tags,
          uriTemplate: item.uriTemplate,
          auth: item.auth,
        })),
      ).map((hit) => resources.find((item) => item.name === hit.name)!)
    : resources;

  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/resources${url.search}`,
      next: explorerCollectionNext("resources"),
      extra: { resources: filtered },
    }),
  );
}
