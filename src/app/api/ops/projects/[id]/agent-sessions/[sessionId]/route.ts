import { NextResponse } from "next/server";
import { eventsToDisplayMessages } from "@/lib/agent-stream";
import {
  getAgentSessionForClient,
  getAllAgentEventsAfter,
} from "@/lib/agent-runner";
import { requireOpsAuth, requireProject } from "@/lib/ops-api-route";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const authError = requireOpsAuth(_request);
  if (authError) return authError;

  const { id, sessionId } = await params;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const agentSession = getAgentSessionForClient(sessionId);
  if (!agentSession || agentSession.projectId !== id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const events = getAllAgentEventsAfter(sessionId, 0);
  const messages = eventsToDisplayMessages(events);

  return NextResponse.json({
    session: agentSession,
    events,
    messages,
  });
}
