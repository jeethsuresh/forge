import { NextResponse } from "next/server";
import { DeployProjectError, rollbackProject } from "@/lib/project-deploy";
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
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;
  const path = `/api/ops/projects/${id}/rollback`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  try {
    const result = await rollbackProject(id);
    return jsonWithAudit(
      result.mode === "forge-self-update"
        ? { updateId: result.deploymentId, mode: result.mode }
        : { deploymentId: result.deploymentId, mode: result.mode },
      { status: 202 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType:
          result.mode === "forge-self-update" ? "forge-rollback" : "rollback",
        resourceId: result.deploymentId,
      },
    );
  } catch (err) {
    if (err instanceof DeployProjectError) {
      return errorWithAudit(err.message, err.status, {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "rollback",
      });
    }
    const message = err instanceof Error ? err.message : "Rollback failed";
    return errorWithAudit(message, 409, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "rollback",
    });
  }
}
