import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { deployAgentSession, getAgentSession } from "@/lib/agent-runner";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, sessionId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const agentSession = getAgentSession(sessionId);
  if (!agentSession || agentSession.projectId !== id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    await deployAgentSession(sessionId);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to deploy session";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
