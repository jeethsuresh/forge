import { NextResponse } from "next/server";
import { eventsToDisplayMessages } from "@/lib/agent-stream";
import {
  getAgentSessionForClient,
  getAllAgentEventsAfter,
} from "@/lib/agent-runner";
import {
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const auth = requireOpsAuth(_request);
  if (auth instanceof NextResponse) return auth;
  const { id, sessionId } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
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
