import { NextResponse } from "next/server";
import { forgeAgentDiscoverDocument } from "@/lib/forge-agent/discover";
import { forgeAgentEnvelope } from "@/lib/forge-agent/envelope";

export async function GET() {
  const doc = forgeAgentDiscoverDocument();
  return NextResponse.json(
    forgeAgentEnvelope({
      self: "/api/ops/discover",
      next: doc.next,
      extra: { ...doc, self: "/api/ops/discover" },
    }),
  );
}
