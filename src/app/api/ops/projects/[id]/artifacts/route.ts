import { NextResponse } from "next/server";
import { listProjectArtifactsApi } from "@/lib/artifact-api";
import {
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

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

  return NextResponse.json({ artifacts: listProjectArtifactsApi(id) });
}
