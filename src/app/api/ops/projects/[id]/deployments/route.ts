import { NextResponse } from "next/server";
import { listOpsDeployments } from "@/lib/ops-api-project";
import { requireOpsAuth, requireProject } from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );

  return NextResponse.json({ deployments: listOpsDeployments(id, limit) });
}
