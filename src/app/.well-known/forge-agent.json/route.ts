import { NextResponse } from "next/server";
import { forgeAgentDiscoverDocument } from "@/lib/forge-agent/discover";

export async function GET() {
  return NextResponse.json(forgeAgentDiscoverDocument());
}
