import { NextResponse } from "next/server";
import { DeployProjectError, deployProject } from "@/lib/project-deploy";
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
  const path = `/api/ops/projects/${id}/deploy`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  const branch = typeof body.branch === "string" ? body.branch.trim() : undefined;
  const deployment =
    typeof body.deployment === "string" && body.deployment.trim()
      ? body.deployment.trim()
      : undefined;

  try {
    const result = await deployProject({
      projectId: id,
      branch,
      target: deployment,
      trigger: "manual",
      authorizeActiveSession: body.authorizeActiveSessionDeploy === true,
      auth,
    });
    return jsonWithAudit(
      {
        ...(result.mode === "forge-self-update"
          ? { updateId: result.deploymentId, mode: result.mode }
          : {
              deploymentId: result.deploymentId,
              deployment: result.deployment,
              mode: "project",
            }),
        branch: result.branch,
        authorizedActiveSession: result.authorizedActiveSession,
      },
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
          result.mode === "forge-self-update" ? "forge-update" : "deployment",
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
        resourceType: "deploy",
      });
    }
    const message = err instanceof Error ? err.message : "Deploy failed";
    return errorWithAudit(message, 409, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "deploy",
    });
  }
}
