import { NextResponse } from "next/server";
import { requestProjectSecret } from "@/lib/agent-secrets";
import {
  errorWithAudit,
  jsonWithAudit,
  readJsonBody,
  requireActionDescription,
  denyIfWrongProject,
  requireOpsAuth,
  requireProject,
  resolveOpsActorSessionId,
} from "@/lib/ops-api-route";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { id, name } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/secrets/${encodeURIComponent(name)}/request`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  const sessionId =
    auth.kind === "session"
      ? auth.sessionId
      : resolveOpsActorSessionId(auth, request);
  if (!sessionId) {
    return errorWithAudit(
      "Secret requests require a session token or X-Forge-Agent-Session-Id",
      400,
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "secret-request",
        resourceId: name,
      },
    );
  }

  const result = requestProjectSecret(sessionId, id, decodeURIComponent(name));
  if (!result.allowed) {
    return errorWithAudit(result.reason, 403, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "secret-request",
      resourceId: name,
    });
  }

  return jsonWithAudit(
    { ok: true, name, value: result.value },
    { status: 200 },
    {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: { actionDescription, name },
      projectId: id,
      resourceType: "secret-request",
      resourceId: name,
    },
  );
}
