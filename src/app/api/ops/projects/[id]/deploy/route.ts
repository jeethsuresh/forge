import { NextResponse } from "next/server";
import { runDeployment } from "@/lib/deployer";
import { isAgentSessionActive, getBlockingAgentSession } from "@/lib/agent-state";
import { isForgeProject } from "@/lib/forge-project";
import { validateBranchName } from "@/lib/github";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { invalidateProjectRuntimeCache } from "@/lib/project-runtime-cache";
import { startForgeUpdate } from "@/lib/self-update";
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
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = requireOpsAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const path = `/api/ops/projects/${id}/deploy`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  if (isAgentSessionActive(id)) {
    const blocking = getBlockingAgentSession(id);
    return errorWithAudit(
      "An agent session is active. End it before deploying.",
      409,
      {
        request,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "deploy",
      },
    );
  }

  const branch = typeof body.branch === "string" ? body.branch.trim() : project.branch;
  const validationError = validateBranchName(branch);
  if (validationError) {
    return errorWithAudit(validationError, 400, {
      request,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "deploy",
    });
  }

  if (isForgeProject(project)) {
    try {
      const updateId = await startForgeUpdate({ branch });
      invalidateProjectRuntimeCache(id);
      return jsonWithAudit(
        { updateId, branch, mode: "forge-self-update" },
        { status: 202 },
        {
          request,
          method: "POST",
          path,
          actionDescription,
          requestBody: body,
          projectId: id,
          resourceType: "forge-update",
          resourceId: updateId,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return errorWithAudit(message, 409, {
        request,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "forge-update",
      });
    }
  }

  try {
    const deploymentId = await runDeployment(id, "manual", { branch });
    invalidateProjectRuntimeCache(id);
    invalidateProjectBranches(id);
    return jsonWithAudit(
      { deploymentId, branch, mode: "project" },
      { status: 202 },
      {
        request,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "deployment",
        resourceId: deploymentId,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deploy failed";
    return errorWithAudit(message, 409, {
      request,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "deployment",
    });
  }
}
