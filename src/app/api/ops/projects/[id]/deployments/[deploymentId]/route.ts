import { NextResponse } from "next/server";
import { getOpsDeployment } from "@/lib/ops-api-project";
import {
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; deploymentId: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id, deploymentId } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;

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
