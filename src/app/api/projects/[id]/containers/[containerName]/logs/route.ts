import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  parseContainerLogQuery,
  readProjectContainerLogs,
} from "@/lib/container-logs";
import { projectComposeSlug } from "@/lib/projects";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; containerName: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, containerName: rawName } = await params;
  const containerName = decodeURIComponent(rawName);
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

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
