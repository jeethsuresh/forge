import { NextResponse } from "next/server";
import { listRecentOpsActions } from "@/lib/ops-api-actions";
import { requireOpsAuth } from "@/lib/ops-api-route";

export async function GET(request: Request) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );

  const filter =
    auth.kind === "session" ? { projectId: auth.projectId } : undefined;

  return NextResponse.json({
    actions: listRecentOpsActions(limit, filter),
  });
}
