import { eq } from "drizzle-orm";
import { existsSync } from "fs";
import { join } from "path";
import { db } from "@/lib/db";
import {
  deployments,
  forgeUpdates,
  projects,
  type DeploymentTrigger,
  type Project,
} from "@/lib/db/schema";
import { sessionEventsHaveFileEdits } from "@/lib/agent-stream";
import {
  commitAgentSessionChanges,
  createRecoveryAgentSession,
  getAgentSession,
  getAllAgentEventsAfter,
  waitForAgentSessionTerminal,
} from "@/lib/agent-runner";
import { runDeployment } from "@/lib/deployer";
import {
  projectSupportsRollback,
  runProjectRollbackDeploy,
} from "@/lib/deploy-rollback";
import {
  findForgeProject,
  forgeSourceDir,
  isForgeProject,
} from "@/lib/forge-project";
import { runScript } from "@/lib/github";
import { startForgeRollback } from "@/lib/self-update";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

export const RECOVERY_PROMPT_PREFIX = "[deploy-recovery]";

const recoveryInProgress = new Set<string>();

const TERMINAL_AGENT_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface DeployFailureContext {
  deploymentId: string;
  projectId: string;
  branch: string;
  trigger: DeploymentTrigger;
  errorMessage: string;
  logs: string;
}

export interface ForgeUpdateFailureContext {
  updateId: string;
  errorMessage: string;
  logs: string;
  branch: string;
}

export function isRecoveryPrompt(prompt: string): boolean {
  return prompt.startsWith(RECOVERY_PROMPT_PREFIX);
}

export { findForgeProject, isForgeProject } from "@/lib/forge-project";

export function buildRecoveryPrompt(context: {
  branch: string;
  errorMessage: string;
  logs: string;
  kind: "project-deploy" | "forge-self-update";
}): string {
  const tail = context.logs.trim().split("\n").slice(-80).join("\n");
  const kindLabel =
    context.kind === "forge-self-update"
      ? `${APP_DISPLAY_NAME} self-update`
      : "Project deployment";

  return `${RECOVERY_PROMPT_PREFIX} ${kindLabel} failed on branch ${context.branch}.

Diagnose and fix the issue so build, test, and deploy can succeed. Make the smallest correct change.

Error:
${context.errorMessage}

Recent logs:
${tail || "(no logs captured)"}`;
}

function appendDeploymentLog(deploymentId: string, message: string): void {
  const row = db
    .select({ logs: deployments.logs })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  db.update(deployments)
    .set({ logs: (row?.logs ?? "") + line })
    .where(eq(deployments.id, deploymentId))
    .run();
}

function agentFixedIssue(sessionId: string): boolean {
  const session = getAgentSession(sessionId);
  if (!session || session.status !== "completed") return false;
  const events = getAllAgentEventsAfter(sessionId, 0);
  return sessionEventsHaveFileEdits(events);
}

export async function waitForDeploymentTerminal(
  deploymentId: string,
  timeoutMs = 30 * 60_000,
): Promise<typeof deployments.$inferSelect | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const dep = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .get();
    if (dep?.completedAt) return dep;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

async function rollbackProjectIfPossible(
  project: Project,
  log: (msg: string) => void,
): Promise<void> {
  try {
    if (isForgeProject(project)) {
      log(`Starting ${APP_DISPLAY_NAME} self-update rollback after failed recovery.`);
      await startForgeRollback();
      log(`${APP_DISPLAY_NAME} rollback initiated.`);
      return;
    }

    if (!projectSupportsRollback(project)) {
      log("Project does not support image rollback.");
      return;
    }

    log("Starting deployment rollback after failed recovery.");
    const rolled = await runProjectRollbackDeploy(project, log);
    if (rolled) {
      log("Deployment rollback completed.");
    } else {
      log("Deployment rollback did not recover production.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Rollback could not be started: ${message}`);
  }
}

async function retryProjectDeploy(
  projectId: string,
  branch: string,
  deploymentId: string,
): Promise<boolean> {
  appendDeploymentLog(deploymentId, "Retrying deployment after recovery agent.");
  const retryId = await runDeployment(projectId, "recovery", {
    branch,
    skipPull: true,
  });
  const result = await waitForDeploymentTerminal(retryId);
  if (result?.status === "success") {
    appendDeploymentLog(
      deploymentId,
      `Recovery deployment ${retryId} succeeded.`,
    );
    return true;
  }
  appendDeploymentLog(
    deploymentId,
    `Recovery deployment failed: ${result?.errorMessage ?? "timed out"}`,
  );
  return false;
}

export async function attemptProjectDeployRecovery(
  context: DeployFailureContext,
): Promise<boolean> {
  if (context.trigger === "recovery") return false;
  if (recoveryInProgress.has(context.projectId)) return false;

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, context.projectId))
    .get();
  if (!project) return false;

  recoveryInProgress.add(context.projectId);
  const log = (msg: string) => appendDeploymentLog(context.deploymentId, msg);

  try {
    log("Deploy failed; starting recovery agent.");
    const sessionId = await createRecoveryAgentSession(
      project,
      context.branch,
      buildRecoveryPrompt({
        branch: context.branch,
        errorMessage: context.errorMessage,
        logs: context.logs,
        kind: "project-deploy",
      }),
    );

    const terminal = await waitForAgentSessionTerminal(sessionId);
    if (!terminal || !TERMINAL_AGENT_STATUSES.has(terminal.status)) {
      log("Recovery agent did not reach a terminal state.");
      if (isForgeProject(project) || projectSupportsRollback(project)) {
        await rollbackProjectIfPossible(project, log);
      }
      return false;
    }

    if (!agentFixedIssue(sessionId)) {
      log("Recovery agent finished without fixing the deployment issue.");
      if (isForgeProject(project) || projectSupportsRollback(project)) {
        await rollbackProjectIfPossible(project, log);
      }
      return false;
    }

    await commitAgentSessionChanges(sessionId);
    const recovered = await retryProjectDeploy(
      context.projectId,
      context.branch,
      context.deploymentId,
    );

    if (!recovered && (isForgeProject(project) || projectSupportsRollback(project))) {
      await rollbackProjectIfPossible(project, log);
    }
    return recovered;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Recovery failed: ${message}`);
    if (isForgeProject(project) || projectSupportsRollback(project)) {
      await rollbackProjectIfPossible(project, log);
    }
    return false;
  } finally {
    recoveryInProgress.delete(context.projectId);
  }
}

export async function retryForgeSourceBuildAndTest(
  log: (msg: string) => void,
): Promise<void> {
  const sourceDir = forgeSourceDir();
  if (!existsSync(join(sourceDir, "build.sh"))) {
    throw new Error(`${APP_DISPLAY_NAME} source directory is missing build.sh (${sourceDir})`);
  }

  const stagingPort = process.env.FORGE_STAGING_PORT ?? "3466";
  const scriptEnv = {
    ...process.env,
    HOST_PORT: stagingPort,
    COMPOSE_PROJECT_NAME: process.env.FORGE_STAGING_PROJECT_NAME ?? "forge-staging",
  };

  log(`Re-running ${APP_DISPLAY_NAME} build after recovery.`);
  await runScript("build.sh", sourceDir, log, { env: scriptEnv });

  if (existsSync(join(sourceDir, "test.sh"))) {
    log(`Re-running ${APP_DISPLAY_NAME} tests after recovery.`);
    await runScript("test.sh", sourceDir, log, { env: scriptEnv });
  }
}

export async function attemptForgeSelfUpdateRecovery(
  context: ForgeUpdateFailureContext,
): Promise<boolean> {
  const project = findForgeProject();
  if (!project) return false;

  if (recoveryInProgress.has(project.id)) return false;
  recoveryInProgress.add(project.id);

  const appendUpdateLog = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    const row = db
      .select({ logs: forgeUpdates.logs })
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, context.updateId))
      .get();
    db.update(forgeUpdates)
      .set({ logs: (row?.logs ?? "") + line })
      .where(eq(forgeUpdates.id, context.updateId))
      .run();
  };

  const log = appendUpdateLog;

  try {
    log(`${APP_DISPLAY_NAME} update failed; starting recovery agent.`);
    const workspacePath = forgeSourceDir();
    const sessionId = await createRecoveryAgentSession(
      project,
      context.branch,
      buildRecoveryPrompt({
        branch: context.branch,
        errorMessage: context.errorMessage,
        logs: context.logs,
        kind: "forge-self-update",
      }),
      { workspacePath },
    );

    const terminal = await waitForAgentSessionTerminal(sessionId);
    if (!terminal || !TERMINAL_AGENT_STATUSES.has(terminal.status)) {
      log("Recovery agent did not reach a terminal state.");
      if (project) {
        await rollbackProjectIfPossible(project, log);
      }
      return false;
    }

    if (!agentFixedIssue(sessionId)) {
      log(`Recovery agent finished without fixing the ${APP_DISPLAY_NAME} update issue.`);
      if (project) {
        await rollbackProjectIfPossible(project, log);
      }
      return false;
    }

    await commitAgentSessionChanges(sessionId, { workspacePath });
    await retryForgeSourceBuildAndTest(log);
    log(`${APP_DISPLAY_NAME} source build and test passed after recovery.`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Recovery failed: ${message}`);
    if (project) {
      await rollbackProjectIfPossible(project, log);
    }
    return false;
  } finally {
    recoveryInProgress.delete(project.id);
  }
}

export function handleProjectDeployFailure(context: DeployFailureContext): void {
  void attemptProjectDeployRecovery(context);
}

export function isRecoveryInProgress(projectId: string): boolean {
  return recoveryInProgress.has(projectId);
}
