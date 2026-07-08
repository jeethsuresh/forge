import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  deployments,
  projects,
  type Project,
} from "@/lib/db/schema";
import { readProjectReleaseState } from "@/lib/deploy-rollback";
import { findForgeProject } from "@/lib/forge-project";

const INTERRUPTED_DEPLOY_STATUSES = [
  "staging",
  "deploying",
  "health_check",
] as const;

function appendDeploymentLog(deploymentId: string, message: string): void {
  const row = db
    .select({ logs: deployments.logs })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get();
  const line = `[${new Date().toISOString()}] ${message}`;
  db.update(deployments)
    .set({ logs: `${row?.logs ?? ""}${line}\n` })
    .where(eq(deployments.id, deploymentId))
    .run();
}

function finalizeAgentSessionsForDeployment(
  deploymentId: string,
  outcome: "completed" | "failed",
  errorMessage?: string,
): void {
  const sessions = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.deploymentId, deploymentId))
    .all();

  for (const session of sessions) {
    if (session.status !== "deploying") continue;

    if (outcome === "completed") {
      db.update(agentSessions)
        .set({
          status: "completed",
          completedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(agentSessions.id, session.id))
        .run();
      continue;
    }

    db.update(agentSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: errorMessage ?? "Deployment failed",
      })
      .where(eq(agentSessions.id, session.id))
      .run();
  }
}

function releaseConfirmsDeployment(
  project: Project,
  commitSha: string,
  startedAt: Date,
): boolean {
  const release = readProjectReleaseState(project.id, project);
  if (!release?.stableCommitSha || release.stableCommitSha !== commitSha) {
    return false;
  }
  const releasedAt = Date.parse(release.updatedAt);
  if (Number.isNaN(releasedAt)) return true;
  return releasedAt >= startedAt.getTime() - 5_000;
}

/**
 * Forge self-deploy recreates the app container mid-flight; reconcile DB rows
 * when release state shows the cutover already succeeded.
 */
export function reconcileInterruptedDeployments(
  projectId?: string,
): number {
  let reconciled = 0;

  const candidates = db
    .select()
    .from(deployments)
    .where(
      projectId
        ? and(
            eq(deployments.projectId, projectId),
            isNull(deployments.completedAt),
          )
        : isNull(deployments.completedAt),
    )
    .all()
    .filter((row) =>
      (INTERRUPTED_DEPLOY_STATUSES as readonly string[]).includes(row.status),
    );

  for (const row of candidates) {
    if (!row.commitSha) continue;

    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .get();
    if (!project) continue;

    if (!releaseConfirmsDeployment(project, row.commitSha, row.startedAt)) {
      continue;
    }

    appendDeploymentLog(
      row.id,
      "Reconciled interrupted deploy after production cutover (container restart).",
    );
    db.update(deployments)
      .set({
        status: "success",
        completedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(deployments.id, row.id))
      .run();

    db.update(projects)
      .set({ lastSeenCommit: row.commitSha, updatedAt: new Date() })
      .where(eq(projects.id, row.projectId))
      .run();

    finalizeAgentSessionsForDeployment(row.id, "completed");
    reconciled += 1;
  }

  return reconciled;
}

export function reconcileForgeInterruptedDeploys(): number {
  const forge = findForgeProject();
  if (!forge) return 0;
  return reconcileInterruptedDeployments(forge.id);
}
