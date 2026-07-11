import { NextResponse } from "next/server";
import { getAgentSession, sendAgentMessage } from "@/lib/agent-runner";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id, sessionId } = await params;
  const path = `/api/ops/projects/${id}/agent-sessions/${sessionId}/messages`;
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

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return errorWithAudit("prompt is required", 400, {
      request,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-message",
      resourceId: sessionId,
    });
  }

  try {
    await sendAgentMessage(sessionId, prompt);
    return jsonWithAudit(
      { ok: true, sessionId },
      { status: 202 },
      {
        request,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "agent-message",
        resourceId: sessionId,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send message";
    return errorWithAudit(message, 409, {
      request,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-message",
      resourceId: sessionId,
    });
  }
}
