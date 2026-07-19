import { NextResponse } from "next/server";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";
import { opsApiBaseUrl } from "@/lib/ops-api-auth";
import { requireOpsAuth } from "@/lib/ops-api-route";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(forgeOpsApiCatalog(opsApiBaseUrl()));
}
