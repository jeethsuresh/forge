import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  commitAgentSessionChanges,
  getAgentSession,
} from "@/lib/agent-runner";
import { commitAllChanges, hasUncommittedChanges } from "@/lib/github";

export async function POST(
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

  let message: string | undefined;
  let sessionId: string | undefined;
  try {
    const body = (await request.json()) as {
      message?: string;
      sessionId?: string;
    };
    message = body.message?.trim();
    sessionId = body.sessionId?.trim();
  } catch {
    // optional body
  }

  const commitMessage =
    message && message.length > 0
      ? message
      : "Manual commit from Changes tab";

  try {
    if (sessionId) {
      const agentSession = getAgentSession(sessionId);
      if (!agentSession || agentSession.projectId !== id) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const result = await commitAgentSessionChanges(sessionId, {
        message: commitMessage,
      });
      return NextResponse.json(result);
    }

    if (!(await hasUncommittedChanges(project.clonePath))) {
      return NextResponse.json({
        committed: false,
        pushed: false,
        commitSha: null,
      });
    }

    const commitSha = await commitAllChanges(
      project.clonePath,
      commitMessage,
    );
    return NextResponse.json({
      committed: commitSha != null,
      pushed: false,
      commitSha,
    });
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : "Failed to commit changes";
    return NextResponse.json({ error: errMessage }, { status: 409 });
  }
}
