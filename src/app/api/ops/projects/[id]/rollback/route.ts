import { NextResponse } from "next/server";
import { isDeploymentActive, runProjectRollback } from "@/lib/deployer";
import { hasRollbackImage, projectSupportsRollback } from "@/lib/deploy-rollback";
import { isForgeProject } from "@/lib/forge-project";
import { startForgeRollback } from "@/lib/self-update";
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

  if (isDeploymentActive(id)) {
    return errorWithAudit(
      "A deployment is already in progress for this project",
      409,
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "rollback",
      },
    );
  }

  if (isForgeProject(project)) {
    try {
      const updateId = await startForgeRollback();
      return jsonWithAudit(
        { updateId, mode: "forge-self-update" },
        { status: 202 },
        {
          request,
          auth,
          method: "POST",
          path,
          actionDescription,
          requestBody: body,
          projectId: id,
          resourceType: "forge-rollback",
          resourceId: updateId,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rollback failed";
      return errorWithAudit(message, 409, {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "forge-rollback",
      });
    }
  }

  if (!projectSupportsRollback(project)) {
    return errorWithAudit("This project does not support rollback", 400, {
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

  if (!(await hasRollbackImage(project))) {
    return errorWithAudit("No rollback image is available", 409, {
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

  try {
    const deploymentId = await runProjectRollback(id);
    return jsonWithAudit(
      { deploymentId, mode: "project" },
      { status: 202 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "rollback",
        resourceId: deploymentId,
      },
    );
  } catch (err) {
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
