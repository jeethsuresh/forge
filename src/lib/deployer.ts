import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
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
  getLocalCommitSha,
  getRemoteCommitSha,
  runScript,
} from "@/lib/github";

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

  db.insert(deployments)
    .values({
      id: deploymentId,
      projectId,
      branch: project.branch,
      status: "pending",
      trigger,
      logs: "",
      startedAt: new Date(),
    })
    .run();

  void executeDeployment(deploymentId, project.id, trigger).finally(() => {
    activeDeployments.delete(projectId);
  });

  return deploymentId;
}

function getLatestSuccessfulDeploymentCommit(projectId: string): string | null {
  const row = db
    .select({ commitSha: deployments.commitSha })
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, projectId),
        eq(deployments.status, "success"),
      ),
    )
    .orderBy(desc(deployments.completedAt))
    .limit(1)
    .get();
  return row?.commitSha ?? null;
}

async function getRecordedDeployedCommitSha(project: Project): Promise<string | null> {
  if (project.lastSeenCommit) return project.lastSeenCommit;
  return getLatestSuccessfulDeploymentCommit(project.id);
}

async function getEffectiveDeployedCommitSha(project: Project): Promise<string | null> {
  const recorded = await getRecordedDeployedCommitSha(project);
  if (recorded) return recorded;
  return getLocalCommitSha(project.clonePath);
}

function syncLastSeenCommit(projectId: string, commitSha: string): void {
  db.update(projects)
    .set({ lastSeenCommit: commitSha, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .run();
}

async function shouldSkipAutoDeploy(
  project: Project,
  remoteSha: string,
): Promise<boolean> {
  const deployedSha = await getEffectiveDeployedCommitSha(project);
  if (deployedSha !== remoteSha) return false;
  if (project.lastSeenCommit !== remoteSha) {
    syncLastSeenCommit(project.id, remoteSha);
  }
  return true;
}

async function shouldSkipAutoBuild(
  project: Project,
  commitSha: string,
): Promise<boolean> {
  const deployedSha = await getRecordedDeployedCommitSha(project);
  if (deployedSha !== commitSha) return false;
  if (project.lastSeenCommit !== commitSha) {
    syncLastSeenCommit(project.id, commitSha);
  }
  return true;
}

async function executeDeployment(
  deploymentId: string,
  projectId: string,
  trigger: DeploymentTrigger,
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

  try {
    updateStatus(deploymentId, "pulling");
    const commitSha = await cloneOrPull(
      project.githubRepo,
      project.branch,
      project.clonePath,
      log,
    );

    db.update(deployments)
      .set({ commitSha })
      .where(eq(deployments.id, deploymentId))
      .run();

    if (trigger === "auto" && (await shouldSkipAutoBuild(project, commitSha))) {
      log(`Already deployed at ${commitSha.slice(0, 7)}, skipping build.`);
      updateStatus(deploymentId, "success", { completedAt: new Date() });
      return;
    }

    updateStatus(deploymentId, "building");
    await runScript("build.sh", project.clonePath, log);

    updateStatus(deploymentId, "deploying");
    await runScript("deploy.sh", project.clonePath, log);

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

  try {
    const remoteSha = await getRemoteCommitSha(project.githubRepo, project.branch);
    if (await shouldSkipAutoDeploy(project, remoteSha)) return false;
    await runDeployment(projectId, "auto");
    return true;
  } catch (err) {
    console.error(`[watcher] Error checking project ${project.name}:`, err);
    return false;
  }
}

export function isDeploymentActive(projectId: string): boolean {
  return activeDeployments.has(projectId);
}
