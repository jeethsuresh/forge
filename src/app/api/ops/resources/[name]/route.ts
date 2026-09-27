import { NextResponse } from "next/server";
import { readForgeAgentResource } from "@/lib/forge-agent/dispatch";
import { explorerCollectionNext, forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { getForgeAgentResource } from "@/lib/forge-agent/registry";
import { readJsonBody } from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const resource = getForgeAgentResource(name);
  if (!resource) {
    return NextResponse.json(
      forgeAgentEnvelope({
        self: `/api/ops/resources/${name}`,
        next: explorerCollectionNext("resources"),
        extra: { error: `Unknown resource: ${name}` },
      }),
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  if (url.searchParams.get("read") === "1") {
    const args: Record<string, unknown> = {};
    url.searchParams.forEach((value, key) => {
      if (key !== "read") args[key] = value;
    });
    return readForgeAgentResource({ nameOrUri: name, args, request });
  }

  return NextResponse.json(
    forgeAgentEnvelope({
      self: `/api/ops/resources/${name}`,
      next: [
        {
          method: "GET",
          href: `/api/ops/resources/${name}?read=1`,
          description: resource.live
            ? "Read live data (Ops bearer)"
            : "Read descriptor",
          auth: resource.auth,
        },
        ...explorerCollectionNext("resources"),
      ],
      extra: { resource },
    }),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const body = await readJsonBody(request);
  return readForgeAgentResource({ nameOrUri: name, args: body, request });
}
