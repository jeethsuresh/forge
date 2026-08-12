import { NextResponse } from "next/server";
import { getAgentSession } from "@/lib/agent-runner";
import {
  ingestAgentEvents,
  type IngestAgentEventInput,
} from "@/lib/agent-events-ingest";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id, sessionId } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/agent-sessions/${sessionId}/events`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const agentSession = getAgentSession(sessionId);
  if (!agentSession || agentSession.projectId !== id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  const rawEvents = body.events;
  const events: IngestAgentEventInput[] = Array.isArray(rawEvents)
    ? (rawEvents as IngestAgentEventInput[])
    : body.event
      ? [body.event as IngestAgentEventInput]
      : body.line
        ? [{ line: String(body.line) }]
        : [];

  if (events.length === 0) {
    return errorWithAudit("events array (or event/line) is required", 400, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-events",
      resourceId: sessionId,
    });
  }

  try {
    const recorded = ingestAgentEvents(sessionId, events);
    return jsonWithAudit(
      { ok: true, sessionId, recorded },
      { status: 200 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "agent-events",
        resourceId: sessionId,
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to ingest events";
    return errorWithAudit(message, 500, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-events",
      resourceId: sessionId,
    });
  }
}
