import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { eventsToDisplayMessages } from "@/lib/agent-stream";
import {
  getAgentSessionForClient,
  getAllAgentEventsAfter,
} from "@/lib/agent-runner";
import { resolveAgentSessionDeployLogs } from "@/lib/agent-session-deploy";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, sessionId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const agentSession = getAgentSessionForClient(sessionId);
  if (!agentSession || agentSession.projectId !== id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const events = getAllAgentEventsAfter(sessionId, 0);
  const messages = eventsToDisplayMessages(events);
  const deployLogView = resolveAgentSessionDeployLogs({
    sessionStatus: agentSession.status,
    deploymentId: agentSession.deploymentId,
  });

  return NextResponse.json({
    session: agentSession,
    events,
    messages,
    deployLogView,
  });
}
