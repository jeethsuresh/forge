import { NextResponse } from "next/server";
import { explorerCollectionNext, forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { listForgeAgentPrompts } from "@/lib/forge-agent/registry";
import { rankForgeAgentHits } from "@/lib/forge-agent/search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const prompts = listForgeAgentPrompts();
  const filtered = q
    ? rankForgeAgentHits(
        q,
        prompts.map((item) => ({
          kind: "prompt" as const,
          name: item.name,
          description: item.description,
          tags: item.tags,
        })),
      ).map((hit) => prompts.find((item) => item.name === hit.name)!)
    : prompts;

  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/prompts${url.search}`,
      next: explorerCollectionNext("prompts"),
      extra: { prompts: filtered },
    }),
  );
}
