import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  buildProjectGitDiff,
  resolveDiffModeFromParams,
} from "@/lib/project-git-diff";
import { listLocalBranches } from "@/lib/github";

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
  const query = {
    mode: url.searchParams.get("mode"),
    base: url.searchParams.get("base"),
    head: url.searchParams.get("head"),
    branch: url.searchParams.get("branch"),
    source: url.searchParams.get("source"),
    onto: url.searchParams.get("onto"),
    target: url.searchParams.get("target"),
    session: url.searchParams.get("session"),
  };
  const file = url.searchParams.get("file") ?? undefined;
  const mode = resolveDiffModeFromParams(query);

  let sessionBranch: string | undefined;
  if (query.session) {
    const agentSession = db
      .select({
        branch: agentSessions.branch,
        projectId: agentSessions.projectId,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, query.session))
      .get();
    if (!agentSession || agentSession.projectId !== id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    sessionBranch = agentSession.branch;
  }

  try {
    const diff = await buildProjectGitDiff(project.clonePath, {
      mode,
      watchBranch: project.branch,
      base: query.base ?? undefined,
      head: query.head ?? undefined,
      branch: query.branch ?? undefined,
      source: query.source ?? undefined,
      onto: query.onto ?? undefined,
      target: query.target ?? undefined,
      sessionBranch,
      file,
    });

    const branches = await listLocalBranches(project.clonePath);

    return NextResponse.json({
      diff,
      branches,
      watchBranch: project.branch,
      sessionId: query.session,
      sessionBranch: sessionBranch ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
