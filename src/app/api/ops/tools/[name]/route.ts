import { NextResponse } from "next/server";
import { explorerCollectionNext, forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { getForgeAgentTool } from "@/lib/forge-agent/registry";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const tool = getForgeAgentTool(name);
  if (!tool) {
    return NextResponse.json(
      forgeAgentEnvelope({
        self: `/api/ops/tools/${name}`,
        next: explorerCollectionNext("tools"),
        extra: { error: `Unknown tool: ${name}` },
      }),
      { status: 404 },
    );
  }

  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/tools/${name}`,
      next: [
        {
          method: "POST",
          href: `/api/ops/tools/${name}/call`,
          description: tool.callable
            ? "Dispatch this tool through existing Ops handlers"
            : "Not callable with Ops auth; use the dashboard cookie session",
          auth: tool.callable ? "ops" : "dashboard_cookie",
        },
        ...explorerCollectionNext("tools"),
      ],
      extra: { tool },
    }),
  );
}
