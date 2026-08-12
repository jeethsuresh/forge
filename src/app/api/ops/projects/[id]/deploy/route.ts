import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { runDeployment } from "@/lib/deployer";
import {
  isAgentSessionActive,
  getBlockingAgentSession,
  getActiveSessionForProject,
} from "@/lib/agent-state";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { isForgeProject } from "@/lib/forge-project";
import { validateBranchName } from "@/lib/github";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { invalidateProjectRuntimeCache } from "@/lib/project-runtime-cache";
import { shouldAuthorizeActiveSessionDeploy } from "@/lib/ops-session-deploy";
import { startForgeUpdate } from "@/lib/self-update";
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

  const authorizeActiveSessionDeploy = body.authorizeActiveSessionDeploy === true;
  const activeSession = getActiveSessionForProject(id);
  const sessionAuthorized = shouldAuthorizeActiveSessionDeploy({
    auth,
    authorizeActiveSessionDeploy,
    blockingSessionId: activeSession?.id,
  });

  if (isAgentSessionActive(id) && !sessionAuthorized) {
    const blocking = getBlockingAgentSession(id);
    return errorWithAudit(
      "An agent session is active. End it before deploying.",
      409,
      {
        request,
        auth,
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
  const deployment =
    typeof body.deployment === "string" && body.deployment.trim()
      ? body.deployment.trim()
      : undefined;
  const validationError = validateBranchName(branch);
  if (validationError) {
    return errorWithAudit(validationError, 400, {
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

  if (isForgeProject(project)) {
    try {
      if (sessionAuthorized && activeSession) {
        db.update(agentSessions)
          .set({ status: "deploying" })
          .where(eq(agentSessions.id, activeSession.id))
          .run();
      }

      const updateId = await startForgeUpdate({ branch });

      if (sessionAuthorized && activeSession) {
        db.update(agentSessions)
          .set({ deploymentId: updateId })
          .where(eq(agentSessions.id, activeSession.id))
          .run();
      }

      invalidateProjectRuntimeCache(id);
      return jsonWithAudit(
        {
          updateId,
          branch,
          mode: "forge-self-update",
          authorizedActiveSession: sessionAuthorized,
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
          resourceType: "forge-update",
          resourceId: updateId,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      return errorWithAudit(message, 409, {
        request,
        auth,
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
    const deploymentId = await runDeployment(id, "manual", {
      branch,
      deployment,
    });
    invalidateProjectRuntimeCache(id);
    invalidateProjectBranches(id);
    return jsonWithAudit(
      { deploymentId, branch, deployment: deployment ?? null, mode: "project" },
      { status: 202 },
      {
        request,
        auth,
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
      auth,
      method: "POST",
      path,
      actionDescription,
      requestBody: body,
      projectId: id,
      resourceType: "deployment",
    });
  }
}
