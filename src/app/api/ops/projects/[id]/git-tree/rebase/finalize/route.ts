import { NextResponse } from "next/server";
import { isDeploymentActive } from "@/lib/deployer";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { finalizeRebaseRecovery } from "@/lib/rebase-recovery";
import { endAgentAndDestroyBranchWorkspace } from "@/lib/agent-runner";
import {
  denyIfWrongProject,
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
  const auth = requireOpsAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const forbidden = denyIfWrongProject(auth, id);
  if (forbidden) return forbidden;

  const path = `/api/ops/projects/${id}/git-tree/rebase/finalize`;
  const project = requireProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (isDeploymentActive(id)) {
    return NextResponse.json(
      { error: "A deployment is in progress. Wait for it to finish." },
      { status: 409 },
    );
  }

  const body = await readJsonBody(request);
  const actionResult = requireActionDescription(body);
  if (actionResult instanceof NextResponse) return actionResult;
  const { actionDescription } = actionResult;

  const recoveryBranch =
    typeof body.recoveryBranch === "string" ? body.recoveryBranch.trim() : "";
  const sourceBranch =
    typeof body.sourceBranch === "string" ? body.sourceBranch.trim() : "";
  if (!recoveryBranch || !sourceBranch) {
    return NextResponse.json(
      { error: "recoveryBranch and sourceBranch are required" },
      { status: 400 },
    );
  }

  try {
    await finalizeRebaseRecovery(project.clonePath, recoveryBranch, sourceBranch, {
      watchBranch: project.branch,
    });
    await endAgentAndDestroyBranchWorkspace(id, sourceBranch, "branch_merged");
    await endAgentAndDestroyBranchWorkspace(id, recoveryBranch, "branch_merged");
    invalidateProjectBranches(id);
    return jsonWithAudit(
      { success: true, recoveryBranch, sourceBranch },
      { status: 200 },
      {
        request,
        auth,
        method: "POST",
        path,
        actionDescription,
        requestBody: body,
        projectId: id,
        resourceType: "rebase-finalize",
        resourceId: sourceBranch,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Finalize failed";
    return errorWithAudit(message, 409, {
      request,
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "rebase-finalize",
    });
  }
}
