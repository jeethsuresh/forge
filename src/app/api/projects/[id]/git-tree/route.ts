import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { isForgeProject } from "@/lib/forge-project";
import {
  GRAPH_PAGE_SIZE,
} from "@/lib/project-git-graph";
import { buildProjectGitGraph } from "@/lib/project-git-graph-build";

function parseSkip(value: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseLimit(value: string | null): number {
  if (!value) return GRAPH_PAGE_SIZE;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return GRAPH_PAGE_SIZE;
  return Math.min(parsed, 50);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const skip = parseSkip(url.searchParams.get("skip"));
  const limit = parseLimit(url.searchParams.get("limit"));

  const graph = await buildProjectGitGraph(project.clonePath, project.branch, {
    skip,
    limit,
  });

  return NextResponse.json({
    graph,
    forgeProject: isForgeProject(project),
  });
}
