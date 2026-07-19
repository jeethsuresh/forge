import { NextResponse } from "next/server";
import { listOpsDeployments } from "@/lib/ops-api-project";
import { denyIfWrongProject,
  requireOpsAuth, requireProject } from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
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
