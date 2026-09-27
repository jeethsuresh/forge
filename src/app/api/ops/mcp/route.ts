import { NextResponse } from "next/server";
import { forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { handleMcpJsonRpc } from "@/lib/forge-agent/mcp";

export async function GET() {
  return NextResponse.json(
    forgeAgentEnvelope({
      self: "/api/ops/mcp",
      next: [
        {
          method: "POST",
          href: "/api/ops/mcp",
          description:
            "v1 is request/response JSON-RPC only. POST initialize, then tools/list or tools/call.",
          auth: "none",
        },
      ],
      extra: {
        error: "Method Not Allowed. Use POST for MCP JSON-RPC (SSE notifications are not in v1).",
      },
    }),
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 },
    );
  }
  return handleMcpJsonRpc(request, raw);
}
