import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import { db } from "@/lib/db";
import {
  deployments,
  projects,
  type DeploymentStatus,
  type DeploymentTrigger,
  type Project,
} from "@/lib/db/schema";
import {
  cloneOrPull,
  checkoutLocalBranch,
  getRemoteCommitSha,
  isCommitAncestor,
  runScript,
} from "@/lib/github";
import { isAgentSessionActive } from "@/lib/agent-state";
import { resolveClonePath } from "@/lib/paths";
import {
  mergeDeployEnvWithProcess,
  parseDeployEnvJson,
} from "@/lib/deploy-env";

const activeDeployments = new Set<string>();

function appendLog(deploymentId: string, message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const row = db
    .select({ logs: deployments.logs })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get();
  const logs = (row?.logs ?? "") + line;
  db.update(deployments).set({ logs }).where(eq(deployments.id, deploymentId)).run();
}

function updateStatus(
  deploymentId: string,
  status: DeploymentStatus,
  extra?: { commitSha?: string; errorMessage?: string; completedAt?: Date },
): void {
  db.update(deployments)
    .set({ status, ...extra })
    .where(eq(deployments.id, deploymentId))
    .run();
}

export async function runDeployment(
  projectId: string,
  trigger: DeploymentTrigger,
  options?: { branch?: string; skipPull?: boolean },
): Promise<string> {
  if (activeDeployments.has(projectId)) {
    throw new Error("A deployment is already in progress for this project");
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) throw new Error("Project not found");

  const deploymentId = randomUUID();
  activeDeployments.add(projectId);

  const deployBranch =
    trigger === "auto"
      ? resolveAutoDeployBranch(project.branch, getLatestDeploymentBranch(project.id))
      : (options?.branch ?? project.branch);

  db.insert(deployments)
    .values({
      id: deploymentId,
      projectId,
      branch: deployBranch,
      status: "pending",
      trigger,
      logs: "",
      startedAt: new Date(),
    })
    .run();

  void executeDeployment(deploymentId, project.id, trigger, options).finally(() => {
    activeDeployments.delete(projectId);
  });

  return deploymentId;
}

function getLatestBuiltCommitSha(
  projectId: string,
  excludeDeploymentId?: string,
): string | null {
  const conditions = [
    eq(deployments.projectId, projectId),
    isNotNull(deployments.commitSha),
  ];
  if (excludeDeploymentId) {
    conditions.push(ne(deployments.id, excludeDeploymentId));
  }

  const row = db
    .select({ commitSha: deployments.commitSha })
    .from(deployments)
    .where(and(...conditions))
    .orderBy(desc(deployments.startedAt))
    .limit(1)
    .get();
  return row?.commitSha ?? null;
}

function getLatestDeploymentBranch(projectId: string): string | null {
  const row = db
    .select({ branch: deployments.branch })
    .from(deployments)
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(deployments.startedAt))
    .limit(1)
    .get();
  return row?.branch ?? null;
}

function getCurrentlyRunningCommitSha(projectId: string): string | null {
  const row = db
    .select({ commitSha: deployments.commitSha })
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, projectId),
        eq(deployments.status, "success"),
        isNotNull(deployments.commitSha),
      ),
    )
    .orderBy(desc(deployments.completedAt))
    .limit(1)
    .get();
  return row?.commitSha ?? null;
}

export function resolveAutoDeployBranch(
  watchBranch: string,
  previousDeploymentBranch: string | null | undefined,
): string {
  return previousDeploymentBranch ?? watchBranch;
}

export function isOlderThanRunningCommit(
  candidateSha: string,
  runningSha: string | null | undefined,
  candidateIsAncestorOfRunning: boolean,
): boolean {
  if (!runningSha) return false;
  if (candidateSha === runningSha) return false;
  return candidateIsAncestorOfRunning;
}

function syncLastSeenCommit(projectId: string, commitSha: string): void {
  db.update(projects)
    .set({ lastSeenCommit: commitSha, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .run();
}

async function shouldSkipAutoWatcherPoll(
  project: Project,
  remoteSha: string,
): Promise<boolean> {
  if (project.lastSeenCommit !== remoteSha) return false;
  const previousBuildSha = getLatestBuiltCommitSha(project.id);
  return previousBuildSha === remoteSha;
}

async function shouldSkipStaleAutoCommit(
  project: Project,
  candidateSha: string,
  runningSha: string | null,
): Promise<boolean> {
  if (!isOlderThanRunningCommit(
    candidateSha,
    runningSha,
    await isCommitAncestor(candidateSha, runningSha ?? "", project.clonePath),
  )) {
    return false;
  }

  if (project.lastSeenCommit !== candidateSha) {
    syncLastSeenCommit(project.id, candidateSha);
  }
  return true;
}

function completeDuplicateDeploy(
  deploymentId: string,
  project: Project,
  commitSha: string,
  log: (msg: string) => void,
  reason: string,
): void {
  db.update(deployments)
    .set({ commitSha })
    .where(eq(deployments.id, deploymentId))
    .run();

  if (project.lastSeenCommit !== commitSha) {
    syncLastSeenCommit(project.id, commitSha);
  }

  log(reason);
  updateStatus(deploymentId, "duplicate", { completedAt: new Date() });
}

export function isSameAsPreviousBuild(
  previousBuildSha: string | null | undefined,
  commitSha: string,
): boolean {
  return Boolean(previousBuildSha && previousBuildSha === commitSha);
}

async function finishAutoDeployIfDuplicate(
  deploymentId: string,
  project: Project,
  commitSha: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const previousBuildSha = getLatestBuiltCommitSha(project.id, deploymentId);
  if (!isSameAsPreviousBuild(previousBuildSha, commitSha)) {
    return false;
  }
  completeDuplicateDeploy(
    deploymentId,
    project,
    commitSha,
    log,
    `Commit ${commitSha.slice(0, 7)} matches the previous build; marking as duplicate.`,
  );
  return true;
}

async function finishAutoDeployIfStale(
  deploymentId: string,
  project: Project,
  commitSha: string,
  runningSha: string,
  log: (msg: string) => void,
): Promise<boolean> {
  if (!isOlderThanRunningCommit(
    commitSha,
    runningSha,
    await isCommitAncestor(commitSha, runningSha, project.clonePath),
  )) {
    return false;
  }

  completeDuplicateDeploy(
    deploymentId,
    project,
    commitSha,
    log,
    `Commit ${commitSha.slice(0, 7)} is older than the currently running ${runningSha.slice(0, 7)}; marking as duplicate.`,
  );
  return true;
}

function resolveDeploymentBranch(
  project: Project,
  trigger: DeploymentTrigger,
  options?: { branch?: string },
): string {
  if (trigger === "auto") {
    return resolveAutoDeployBranch(
      project.branch,
      getLatestDeploymentBranch(project.id),
    );
  }
  return options?.branch ?? project.branch;
}

async function executeDeployment(
  deploymentId: string,
  projectId: string,
  trigger: DeploymentTrigger,
  options?: { branch?: string; skipPull?: boolean },
): Promise<void> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    updateStatus(deploymentId, "failed", {
      errorMessage: "Project not found",
      completedAt: new Date(),
    });
    return;
  }

  const log = (msg: string) => appendLog(deploymentId, msg);
  const deployBranch = resolveDeploymentBranch(project, trigger, options);
  const runningSha = getCurrentlyRunningCommitSha(projectId);
  const scriptEnv = mergeDeployEnvWithProcess(parseDeployEnvJson(project.deployEnvJson));

  try {
    const repoPath = resolveClonePath(project.clonePath);

    if (trigger === "auto" && !options?.skipPull) {
      const remoteSha = await getRemoteCommitSha(
        project.githubRepo,
        deployBranch,
      );

      if (
        runningSha &&
        (await finishAutoDeployIfStale(deploymentId, project, remoteSha, runningSha, log))
      ) {
        return;
      }
      if (await finishAutoDeployIfDuplicate(deploymentId, project, remoteSha, log)) {
        return;
      }
    }

    updateStatus(deploymentId, "pulling");
    let commitSha: string;

    if (options?.skipPull) {
      log(`Using local branch ${deployBranch} (agent changes preserved).`);
      commitSha = await checkoutLocalBranch(repoPath, deployBranch, log);
    } else {
      commitSha = await cloneOrPull(
        project.githubRepo,
        deployBranch,
        repoPath,
        log,
      );
    }

    db.update(deployments)
      .set({ commitSha })
      .where(eq(deployments.id, deploymentId))
      .run();

    if (trigger === "auto") {
      if (runningSha && (await finishAutoDeployIfStale(deploymentId, project, commitSha, runningSha, log))) {
        return;
      }
      if (await finishAutoDeployIfDuplicate(deploymentId, project, commitSha, log)) {
        return;
      }
    }

    updateStatus(deploymentId, "building");
    await runScript("build.sh", repoPath, log, { env: scriptEnv });

    updateStatus(deploymentId, "testing");
    if (existsSync(join(repoPath, "test.sh"))) {
      await runScript("test.sh", repoPath, log, { env: scriptEnv });
    } else {
      log("test.sh not found, skipping tests.");
    }

    updateStatus(deploymentId, "deploying");
    await runScript("deploy.sh", repoPath, log, { env: scriptEnv });

    updateStatus(deploymentId, "success", { completedAt: new Date() });

    syncLastSeenCommit(projectId, commitSha);

    log(`Deployment successful (${commitSha.slice(0, 7)}).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    updateStatus(deploymentId, "failed", {
      errorMessage: message,
      completedAt: new Date(),
    });
  }
}

export async function checkProjectForChanges(projectId: string): Promise<boolean> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project || !project.enabled) return false;
  if (activeDeployments.has(projectId)) return false;
  if (isAgentSessionActive(projectId)) return false;

  try {
    const autoBranch = resolveAutoDeployBranch(
      project.branch,
      getLatestDeploymentBranch(projectId),
    );
    const remoteSha = await getRemoteCommitSha(project.githubRepo, autoBranch);
    const runningSha = getCurrentlyRunningCommitSha(projectId);

    if (await shouldSkipStaleAutoCommit(project, remoteSha, runningSha)) {
      return false;
    }
    if (await shouldSkipAutoWatcherPoll(project, remoteSha)) return false;

    await runDeployment(projectId, "auto", { branch: autoBranch });
    return true;
  } catch (err) {
    console.error(`[watcher] Error checking project ${project.name}:`, err);
    return false;
  }
}

export function isDeploymentActive(projectId: string): boolean {
  return activeDeployments.has(projectId);
}
