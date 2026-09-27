import { NextResponse } from "next/server";
import { explorerCollectionNext, forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { getForgeAgentPrompt, renderForgeAgentPrompt } from "@/lib/forge-agent/registry";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const prompt = getForgeAgentPrompt(name);
  if (!prompt) {
    return NextResponse.json(
      forgeAgentEnvelope({
        self: `/api/ops/prompts/${name}`,
        next: explorerCollectionNext("prompts"),
        extra: { error: `Unknown prompt: ${name}` },
      }),
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const args: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    args[key] = value;
  });

  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/prompts/${name}${url.search}`,
      next: explorerCollectionNext("prompts"),
      extra: {
        prompt,
        text: renderForgeAgentPrompt(prompt, args),
      },
    }),
  );
}
