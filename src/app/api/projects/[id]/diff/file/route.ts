import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { resolveDiffModeFromParams } from "@/lib/project-git-diff";
import { readProjectGitFile, writeProjectGitFile } from "@/lib/project-git-file";

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
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

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
    const file = await readProjectGitFile(
      project.clonePath,
      {
        mode,
        watchBranch: project.branch,
        base: query.base ?? undefined,
        head: query.head ?? undefined,
        branch: query.branch ?? undefined,
        source: query.source ?? undefined,
        onto: query.onto ?? undefined,
        target: query.target ?? undefined,
        sessionBranch,
      },
      filePath,
    );

    return NextResponse.json({ file });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(
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

  let body: { path?: string; content?: string };
  try {
    body = (await request.json()) as { path?: string; content?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filePath = body.path?.trim();
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  try {
    await writeProjectGitFile(project.clonePath, filePath, body.content);
    return NextResponse.json({ saved: true, path: filePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
