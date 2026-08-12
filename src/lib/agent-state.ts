import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentContainers,
  agentEvents,
  agentSessions,
  deployments,
  forgeUpdates,
} from "@/lib/db/schema";
import {
  reconcileAbandonedDeployingSessions,
} from "@/lib/deploy-reconcile";
import {
  isAgentTurnComplete,
  isStuckActiveSession,
  isTerminalSessionStatus,
} from "@/lib/agent-turn";
import {
  isIdleAgentSession,
  resolveAgentSessionSource,
  shouldAutoCompleteRecoverySession,
} from "@/lib/agent-session-source";
import {
  isForgeUpdateSuccessful,
  isForgeUpdateTerminalStatus,
} from "@/lib/ops-session-deploy";
import {
  agentContainerIsRunning,
  removeAgentContainer,
  setAgentContainerKillReason,
} from "@/lib/agent-container";

export const activeAgentProjects = new Set<string>();

const ACTIVE_STATUSES = ["pending", "running", "deploying"] as const;

function appendSessionLog(sessionId: string, message: string): void {
  const row = db
    .select({ logs: agentSessions.logs })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  db.update(agentSessions)
    .set({ logs: `${row?.logs ?? ""}${line}` })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

function sessionEvents(sessionId: string) {
  return db
    .select({
      seq: agentEvents.seq,
      eventType: agentEvents.eventType,
      payload: agentEvents.payload,
    })
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId))
    .orderBy(agentEvents.seq)
    .all();
}

function finalizeDeployingSessionFromForgeUpdate(
  session: typeof agentSessions.$inferSelect,
): boolean {
  if (session.status !== "deploying" || !session.deploymentId) return false;

  const update = db
    .select()
    .from(forgeUpdates)
    .where(eq(forgeUpdates.id, session.deploymentId))
    .get();
  if (!update?.completedAt || !isForgeUpdateTerminalStatus(update.status)) {
    return false;
  }

  if (isForgeUpdateSuccessful(update.status)) {
    appendSessionLog(
      session.id,
      "Forge self-update completed successfully.",
    );
    db.update(agentSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        errorMessage: null,
        commitSha: update.targetCommitSha ?? session.commitSha,
      })
      .where(eq(agentSessions.id, session.id))
      .run();
  } else {
    const message = update.errorMessage ?? `Forge update ${update.status}`;
    appendSessionLog(session.id, `Forge self-update failed: ${message}`);
    db.update(agentSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(agentSessions.id, session.id))
      .run();
  }

  activeAgentProjects.delete(session.projectId);
  return true;
}

function finalizeDeployingSessionFromDeployment(
  session: typeof agentSessions.$inferSelect,
): boolean {
  if (session.status !== "deploying" || !session.deploymentId) return false;

  if (finalizeDeployingSessionFromForgeUpdate(session)) {
    return true;
  }

  const deployment = db
    .select()
    .from(deployments)
    .where(eq(deployments.id, session.deploymentId))
    .get();

  if (!deployment?.completedAt) return false;

  if (deployment.status === "success") {
    appendSessionLog(session.id, "Rebuild and release completed successfully.");
    db.update(agentSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(agentSessions.id, session.id))
      .run();
  } else {
    const message = deployment.errorMessage ?? "Deployment failed";
    appendSessionLog(session.id, `Deployment failed: ${message}`);
    db.update(agentSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(agentSessions.id, session.id))
      .run();
  }

  activeAgentProjects.delete(session.projectId);
  return true;
}

/**
 * Apply a finished deployment to the agent session only while it is still the
 * current deploying attempt. Skips if recovery (or another action) already
 * moved the session out of deploying / cleared the deployment id.
 */
export function applyAgentDeploymentOutcome(
  sessionId: string,
  deploymentId: string,
): boolean {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) return false;
  if (session.status !== "deploying") return false;
  if (session.deploymentId !== deploymentId) return false;

  return finalizeDeployingSessionFromDeployment(session);
}

function reconcileStaleActiveSessions(projectId: string): number {
  if (activeAgentProjects.has(projectId)) return 0;

  const sessions = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, [...ACTIVE_STATUSES]),
        isNull(agentSessions.completedAt),
        isNull(agentSessions.archivedAt),
      ),
    )
    .all();

  let reconciled = 0;
  for (const session of sessions) {
    if (session.status === "deploying") {
      if (finalizeDeployingSessionFromDeployment(session)) {
        reconciled += 1;
      }
      continue;
    }

    const turnIncomplete = !isAgentTurnComplete(sessionEvents(session.id));

    // Finished manual or recovery turns should not linger as running and block new agents.
    if (session.status === "running" && !turnIncomplete) {
      if (shouldAutoCompleteRecoverySession(session)) {
        appendSessionLog(
          session.id,
          "Recovery agent finished. Session marked completed; review workspace for uncommitted changes.",
        );
      } else {
        appendSessionLog(
          session.id,
          "Agent turn finished. Session marked completed.",
        );
      }
      db.update(agentSessions)
        .set({
          status: "completed",
          completedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(agentSessions.id, session.id))
        .run();
      reconciled += 1;
      continue;
    }

    const stuck = isStuckActiveSession({
      status: session.status,
      failedTurnStartSeq: session.failedTurnStartSeq,
      hasActiveProcess: false,
      projectMarkedActive: false,
      turnIncomplete,
    });
    if (!stuck) continue;

    const message =
      session.status === "pending"
        ? "Agent session did not start (orchestrator restarted or session interrupted)"
        : "Agent session interrupted";

    appendSessionLog(session.id, message);
    db.update(agentSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(agentSessions.id, session.id))
      .run();
    reconciled += 1;
  }

  if (reconciled > 0) {
    activeAgentProjects.delete(projectId);
  }

  return reconciled;
}

/**
 * Fail active sessions whose agent_containers row is already stopped/removed
 * (sync path used by deploy gating / list endpoints).
 */
function reconcileStoppedContainerSessions(projectId: string): number {
  const sessions = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, [...ACTIVE_STATUSES]),
        isNull(agentSessions.completedAt),
        isNull(agentSessions.archivedAt),
      ),
    )
    .all();

  let reconciled = 0;
  for (const session of sessions) {
    const container = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, session.id))
      .get();
    if (!container) continue;
    if (container.status !== "stopped" && container.status !== "removed") {
      continue;
    }

    const reason = container.killReason ?? "reconcile_missing";
    const message =
      reason === "reconcile_missing"
        ? "Agent container missing or stopped; session reconciled"
        : `Agent container stopped (${reason})`;

    appendSessionLog(session.id, message);
    if (!container.killReason) {
      setAgentContainerKillReason(session.id, "reconcile_missing");
    }
    db.update(agentSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(agentSessions.id, session.id))
      .run();
    activeAgentProjects.delete(projectId);
    reconciled += 1;
  }
  return reconciled;
}

/**
 * Async: inspect runtime and fail sessions whose containers disappeared.
 */
export async function reconcileMissingAgentContainers(
  projectId?: string,
): Promise<number> {
  const containers = db
    .select()
    .from(agentContainers)
    .where(inArray(agentContainers.status, ["starting", "running"]))
    .all();

  let reconciled = 0;
  for (const container of containers) {
    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, container.sessionId))
      .get();
    if (!session) continue;
    if (projectId && session.projectId !== projectId) continue;
    if (
      session.status !== "running" &&
      session.status !== "pending" &&
      session.status !== "deploying"
    ) {
      continue;
    }
    if (session.archivedAt || session.completedAt) continue;

    const running = await agentContainerIsRunning(session.id);
    if (running) continue;

    const message =
      "Agent container missing from runtime; session failed by reconcile";
    setAgentContainerKillReason(session.id, "reconcile_missing");
    try {
      await removeAgentContainer(session.id);
    } catch {
      // ignore
    }
    appendSessionLog(session.id, message);
    db.update(agentSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(agentSessions.id, session.id))
      .run();
    activeAgentProjects.delete(session.projectId);
    reconciled += 1;
  }
  return reconciled;
}

/** Reconcile orphaned agent rows so failed/interrupted sessions do not block deploys. */
export function reconcileProjectAgentSessions(projectId: string): number {
  let reconciled = reconcileAbandonedDeployingSessions(projectId);

  const deploying = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.status, "deploying"),
        isNull(agentSessions.completedAt),
        isNull(agentSessions.archivedAt),
      ),
    )
    .all();

  for (const session of deploying) {
    if (finalizeDeployingSessionFromDeployment(session)) {
      reconciled += 1;
    }
  }

  reconciled += reconcileStoppedContainerSessions(projectId);
  reconciled += reconcileStaleActiveSessions(projectId);
  return reconciled;
}

export function isAgentSessionActive(projectId: string): boolean {
  reconcileProjectAgentSessions(projectId);

  if (activeAgentProjects.has(projectId)) return true;

  const row = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, [...ACTIVE_STATUSES]),
        isNull(agentSessions.completedAt),
        isNull(agentSessions.archivedAt),
      ),
    )
    .get();

  return Boolean(row);
}

export function getActiveSessionForProject(projectId: string) {
  reconcileProjectAgentSessions(projectId);

  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, [...ACTIVE_STATUSES]),
        isNull(agentSessions.completedAt),
        isNull(agentSessions.archivedAt),
      ),
    )
    .orderBy(desc(agentSessions.startedAt))
    .limit(1)
    .get();
}

export function getBlockingAgentSession(projectId: string) {
  const session = getActiveSessionForProject(projectId);
  if (!session || isTerminalSessionStatus(session.status) || isIdleAgentSession(session.status)) {
    return null;
  }
  const sessionSource = resolveAgentSessionSource(session);
  return { ...session, sessionSource };
}
