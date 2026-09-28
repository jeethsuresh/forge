import { NextResponse } from "next/server";
import {
  parseContainerLogQuery,
  readProjectContainerLogs,
} from "@/lib/container-logs";
import { projectComposeSlug } from "@/lib/projects";
import {
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; containerName: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id, containerName: rawName } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;

  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const containerName = decodeURIComponent(rawName);
  const { tail, refresh } = parseContainerLogQuery(new URL(request.url));
  const view = await readProjectContainerLogs({
    projectId: project.id,
    repoPath: project.clonePath,
    composeSlug: projectComposeSlug(project),
    containerName,
    tail,
    refresh,
  });
  if (!view) {
    return NextResponse.json({ error: "Container logs not found" }, { status: 404 });
  }
  return NextResponse.json(view);
}
