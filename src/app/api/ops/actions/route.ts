import { NextResponse } from "next/server";
import { listRecentOpsActions } from "@/lib/ops-api-actions";
import { requireOpsAuth } from "@/lib/ops-api-route";

export async function GET(request: Request) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );

  return NextResponse.json({ actions: listRecentOpsActions(limit) });
}
