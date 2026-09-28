/**
 * Product-owned cleanup for Layer C live-smoke throwaway branches.
 * `forge-smoke/*` sessions, workspaces, and git refs are ephemeral.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  branchWorkspaces,
  deployments,
  forgeUpdates,
  projects,
  type AgentSessionStatus,
} from "@/lib/db/schema";
import { endAgentAndDestroyBranchWorkspace } from "@/lib/agent-session-lifecycle";
import { checkoutBranch, formatGitError } from "@/lib/git-workspace";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import { isActiveDeploymentStatus } from "@/lib/project-poll";
import {
  LocalBranchOpError,
  deleteLocalBranch,
  getCurrentLocalBranch,
} from "@/lib/project-local-branch-ops";
import { isInProgressForgeUpdateStatus } from "@/lib/self-update-helpers";
import { isForgeSmokeBranch } from "@/lib/forge-smoke-agent";

const execFileAsync = promisify(execFile);

export const FORGE_SMOKE_CLEANUP_GRACE_MS = 10 * 60 * 1000;

const BLOCKING_SESSION_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "queued",
  "pending",
  "running",
  "deploying",
]);

export type ForgeSmokeCleanupResult = {
  cleaned: boolean;
  reason?: string;
};

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

function defaultWatchBranch(): string {
  return process.env.FORGE_SELF_BRANCH?.trim() || "main";
}

function sessionTimestamp(session: {
  completedAt: Date | null;
  startedAt: Date;
}): Date {
  return session.completedAt ?? session.startedAt;
}

function isPastGrace(
  timestamp: Date,
  now: Date,
  graceMs = FORGE_SMOKE_CLEANUP_GRACE_MS,
): boolean {
  return now.getTime() - timestamp.getTime() >= graceMs;
}

export function isForgeSmokeSessionBlocking(status: AgentSessionStatus): boolean {
  return BLOCKING_SESSION_STATUSES.has(status);
}

function loadProject(projectId: string) {
  return db.select().from(projects).where(eq(projects.id, projectId)).get();
}

function liveSmokeSession(projectId: string, branch: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.branch, branch),
        isNull(agentSessions.archivedAt),
      ),
    )
    .get();
}

export function isForgeSmokeUpdateInProgress(
  projectId: string,
  branch: string,
): boolean {
  const deps = db
    .select()
    .from(deployments)
    .where(
      and(eq(deployments.projectId, projectId), eq(deployments.branch, branch)),
    )
    .all();
  for (const dep of deps) {
    if (isActiveDeploymentStatus(dep.status)) return true;
    const update = db
      .select()
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, dep.id))
      .get();
    if (update && isInProgressForgeUpdateStatus(update.status)) return true;
  }
  return false;
}

function smokeCleanupBlocked(
  projectId: string,
  branch: string,
): ForgeSmokeCleanupResult | null {
  const session = liveSmokeSession(projectId, branch);
  if (session && isForgeSmokeSessionBlocking(session.status)) {
    return { cleaned: false, reason: "active_session" };
  }
  if (isForgeSmokeUpdateInProgress(projectId, branch)) {
    return { cleaned: false, reason: "update_in_progress" };
  }
  return null;
}

async function restoreWatchBranch(projectId: string): Promise<string> {
  const watch = defaultWatchBranch();
  const project = loadProject(projectId);
  if (!project) return watch;

  if (isForgeSmokeBranch(project.branch)) {
    db.update(projects)
      .set({ branch: watch, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .run();
  }

  const current = loadProject(projectId);
  const target =
    current && !isForgeSmokeBranch(current.branch) ? current.branch : watch;

  try {
    const head = await getCurrentLocalBranch(project.clonePath);
    if (head && isForgeSmokeBranch(head)) {
      await checkoutBranch(project.clonePath, target);
    }
  } catch (err) {
    console.error(
      `[forge] Smoke cleanup could not restore HEAD off smoke branch: ${formatGitError(err)}`,
    );
  }
  return target;
}

async function deleteSmokeGitRefs(
  clonePath: string,
  branch: string,
  watchBranch: string,
): Promise<void> {
  try {
    await deleteLocalBranch(clonePath, branch, {
      watchBranch,
      force: true,
    });
  } catch (err) {
    if (err instanceof LocalBranchOpError && err.status === 404) return;
    console.error(
      `[forge] Smoke cleanup local branch delete failed for ${branch}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    await execFileAsync("git", ["push", "origin", "--delete", branch], {
      cwd: clonePath,
      env: gitEnv(),
    });
  } catch {
    // Remote may not exist or the ref may already be gone.
  }
}

export async function cleanupForgeSmokeBranch(
  projectId: string,
  branch: string,
): Promise<ForgeSmokeCleanupResult> {
  if (!isForgeSmokeBranch(branch)) {
    return { cleaned: false, reason: "not_smoke" };
  }

  const project = loadProject(projectId);
  if (!project) {
    return { cleaned: false, reason: "no_project" };
  }

  const blocked = smokeCleanupBlocked(projectId, branch);
  if (blocked) return blocked;

  const watchBranch = await restoreWatchBranch(projectId);

  try {
    await endAgentAndDestroyBranchWorkspace(
      projectId,
      branch,
      "branch_deleted",
    );
  } catch (err) {
    console.error(
      `[forge] Smoke cleanup session/workspace teardown failed for ${branch}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  await deleteSmokeGitRefs(project.clonePath, branch, watchBranch);
  invalidateProjectBranches(projectId);
  return { cleaned: true };
}

export async function maybeCleanupForgeSmokeAfterUpdate(
  updateId: string,
): Promise<void> {
  try {
    const update = db
      .select()
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, updateId))
      .get();
    if (!update || isInProgressForgeUpdateStatus(update.status)) return;

    const dep = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, updateId))
      .get();
    if (!dep || !isForgeSmokeBranch(dep.branch)) return;

    await cleanupForgeSmokeBranch(dep.projectId, dep.branch);
  } catch (err) {
    console.error(
      `[forge] Smoke cleanup after update ${updateId.slice(0, 8)} failed:`,
      err,
    );
  }
}

export async function sweepForgeSmokeLeftovers(
  now: Date = new Date(),
): Promise<{ cleaned: string[] }> {
  const cleaned: string[] = [];
  try {
    const keys = new Map<string, { projectId: string; branch: string }>();

    const sessions = db
      .select()
      .from(agentSessions)
      .where(isNull(agentSessions.archivedAt))
      .all();
    for (const session of sessions) {
      if (!isForgeSmokeBranch(session.branch)) continue;
      keys.set(`${session.projectId}:${session.branch}`, {
        projectId: session.projectId,
        branch: session.branch,
      });
    }

    const workspaces = db.select().from(branchWorkspaces).all();
    for (const workspace of workspaces) {
      if (!isForgeSmokeBranch(workspace.branch)) continue;
      keys.set(`${workspace.projectId}:${workspace.branch}`, {
        projectId: workspace.projectId,
        branch: workspace.branch,
      });
    }

    for (const { projectId, branch } of keys.values()) {
      if (smokeCleanupBlocked(projectId, branch)) continue;

      const session = sessions.find(
        (row) => row.projectId === projectId && row.branch === branch,
      );
      if (session && !isPastGrace(sessionTimestamp(session), now)) continue;

      if (!session) {
        const workspace = workspaces.find(
          (row) => row.projectId === projectId && row.branch === branch,
        );
        if (
          workspace &&
          !isPastGrace(workspace.createdAt, now)
        ) {
          continue;
        }
      }

      const result = await cleanupForgeSmokeBranch(projectId, branch);
      if (result.cleaned) cleaned.push(`${projectId}:${branch}`);
    }
  } catch (err) {
    console.error("[forge] Smoke leftover sweep failed:", err);
  }
  return { cleaned };
}
