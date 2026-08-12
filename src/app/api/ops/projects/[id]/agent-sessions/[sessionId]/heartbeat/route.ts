import { NextResponse } from "next/server";
import { getAgentSession } from "@/lib/agent-runner";
import { recordAgentHeartbeat } from "@/lib/agent-heartbeat";
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
  const path = `/api/ops/projects/${id}/agent-sessions/${sessionId}/heartbeat`;
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

  try {
    recordAgentHeartbeat(sessionId);
    return jsonWithAudit(
      { ok: true, sessionId },
      { status: 200 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "agent-heartbeat",
        resourceId: sessionId,
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to record heartbeat";
    return errorWithAudit(message, 500, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-heartbeat",
      resourceId: sessionId,
    });
  }
}
