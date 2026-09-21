import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  projects,
  type DeploymentTrigger,
  type Project,
} from "@/lib/db/schema";
import {
  isDeploymentActive,
  runDeployment,
  runProjectRollback,
} from "@/lib/deployer";
import {
  getActiveSessionForProject,
} from "@/lib/agent-state";
import { isForgeProject } from "@/lib/forge-project";
import { validateBranchName } from "@/lib/git-workspace";
import { startForgeRollback, startForgeUpdate } from "@/lib/self-update";
import {
  patchAgentSession,
  transition,
} from "@/lib/agent-session-machine";
import { shouldAuthorizeActiveSessionDeploy } from "@/lib/ops-session-deploy";
import type { OpsAuth } from "@/lib/ops-api-auth";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { invalidateProjectRuntimeCache } from "@/lib/project-runtime-cache";
import {
  hasRollbackImage,
  projectSupportsRollback,
} from "@/lib/deploy-rollback";

export class DeployProjectError extends Error {
  status: number;
  extra?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DeployProjectError";
    this.status = status;
    this.extra = extra;
  }
}

export type DeployProjectResult = {
  deploymentId: string;
  branch: string;
  mode: "project" | "forge-self-update";
  deployment: string | null;
  authorizedActiveSession: boolean;
};

export type RollbackProjectResult = {
  deploymentId: string;
  mode: "project" | "forge-self-update";
};

function requireProject(projectId: string): Project {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new DeployProjectError("Project not found", 404);
  }
  return project;
}

export async function deployProject(input: {
  projectId: string;
  branch?: string;
  target?: string;
  trigger?: DeploymentTrigger;
  authorizeActiveSession?: boolean;
  auth?: OpsAuth;
}): Promise<DeployProjectResult> {
  const project = requireProject(input.projectId);
  const activeSession = getActiveSessionForProject(input.projectId);
  const sessionAuthorized =
    input.authorizeActiveSession === true &&
    input.auth != null &&
    shouldAuthorizeActiveSessionDeploy({
      auth: input.auth,
      authorizeActiveSessionDeploy: true,
      blockingSessionId: activeSession?.id,
    });

  const branch = input.branch?.trim() || project.branch;
  const validationError = validateBranchName(branch);
  if (validationError) {
    throw new DeployProjectError(validationError, 400);
  }

  if (isForgeProject(project)) {
    if (sessionAuthorized && activeSession) {
      transition(activeSession.id, { type: "deploy_start" });
    }
    const updateId = await startForgeUpdate({ branch });
    if (sessionAuthorized && activeSession) {
      patchAgentSession(activeSession.id, { deploymentId: updateId });
    }
    invalidateProjectRuntimeCache(input.projectId);
    return {
      deploymentId: updateId,
      branch,
      mode: "forge-self-update",
      deployment: input.target?.trim() || null,
      authorizedActiveSession: sessionAuthorized,
    };
  }

  const deploymentId = await runDeployment(
    input.projectId,
    input.trigger ?? "manual",
    {
      branch,
      deployment: input.target,
      skipPull: input.trigger === "agent",
    },
  );
  invalidateProjectRuntimeCache(input.projectId);
  invalidateProjectBranches(input.projectId);
  return {
    deploymentId,
    branch,
    mode: "project",
    deployment: input.target?.trim() || null,
    authorizedActiveSession: sessionAuthorized,
  };
}

export async function rollbackProject(projectId: string): Promise<RollbackProjectResult> {
  const project = requireProject(projectId);

  if (isDeploymentActive(projectId)) {
    throw new DeployProjectError(
      "A deployment is already in progress for this project",
      409,
    );
  }

  if (isForgeProject(project)) {
    const updateId = await startForgeRollback();
    return { deploymentId: updateId, mode: "forge-self-update" };
  }

  if (!projectSupportsRollback(project)) {
    throw new DeployProjectError("This project does not support rollback", 400);
  }
  if (!(await hasRollbackImage(project))) {
    throw new DeployProjectError("No rollback image is available", 409);
  }

  const deploymentId = await runProjectRollback(projectId);
  return { deploymentId, mode: "project" };
}
