import { NextResponse } from "next/server";
import {
  createAgentSession,
  getBranchAgentOverview,
  listAgentSessionsForClient,
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
  requireOpsAuth,
  requireProject,
} from "@/lib/ops-api-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  reconcileInterruptedDeployments(id);
  reconcileAbandonedDeployingSessions(id);

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
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id } = await params;
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
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-session",
    });
  }

  try {
    const sessionId = await createAgentSession(id, branch, prompt);
    return jsonWithAudit(
      { sessionId, branch },
      { status: 201 },
      {
        request,
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
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "agent-session",
    });
  }
}
