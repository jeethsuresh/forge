import { NextResponse } from "next/server";
import {
  createAgentSession,
  getBranchAgentOverview,
  listAgentSessionsForClient,
  drainQueuedAgentSessions,
} from "@/lib/agent-runner";
import { getActiveSessionForProject, isAgentSessionActive } from "@/lib/agent-state";
import {
  reconcileAbandonedDeployingSessions,
  reconcileInterruptedDeployments,
} from "@/lib/deploy-reconcile";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  reconcileInterruptedDeployments(id);
  reconcileAbandonedDeployingSessions(id);
  drainQueuedAgentSessions(id);

  const sessions = listAgentSessionsForClient(id);
  const activeSession = getActiveSessionForProject(id);
  const branches = await getBranchAgentOverview(id);

  return NextResponse.json({
    sessions,
    branches,
    activeSession: activeSession ?? null,
    hasActiveSession: isAgentSessionActive(id),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/agent-sessions`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  if (!prompt) {
    return errorWithAudit("prompt is required", 400, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-session",
    });
  }
  if (!branch) {
    return errorWithAudit("branch is required", 400, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-session",
    });
  }

  try {
    const { sessionId, queued } = await createAgentSession(id, branch, prompt);
    return jsonWithAudit(
      { sessionId, branch, queued },
      { status: queued ? 202 : 201 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "agent-session",
        resourceId: sessionId,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    const status = message.includes("already active") ? 409 : 500;
    return errorWithAudit(message, status, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-session",
    });
  }
}
