import { NextResponse } from "next/server";
import { getOpsDeployment } from "@/lib/ops-api-project";
import { requireOpsAuth, requireProject } from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; deploymentId: string }> },
) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id, deploymentId } = await params;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const deployment = getOpsDeployment(id, deploymentId);
  if (!deployment) {
    return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  }

  return NextResponse.json({ deployment });
}
