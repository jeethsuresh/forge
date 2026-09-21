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
  sessionHasLiveRuntime,
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
  inspectAgentContainerState,
  removeAgentContainer,
  setAgentContainerKillReason,
} from "@/lib/agent-container";
import {
  shouldFailStoppedContainer,
  transition,
} from "@/lib/agent-session-machine";

export const activeAgentProjects = new Set<string>();
export const activeAgentSessions = new Set<string>();

const ACTIVE_STATUSES = ["pending", "running", "deploying"] as const;

export function markAgentSessionLive(sessionId: string, projectId: string): void {
  activeAgentSessions.add(sessionId);
  activeAgentProjects.add(projectId);
}

export function markAgentSessionIdle(sessionId: string, projectId: string): void {
  activeAgentSessions.delete(sessionId);
  const remaining = db
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
    .all()
    .some((row) => row.id !== sessionId);
  const remainingInMemory = [...activeAgentSessions].some((id) => {
    if (id === sessionId) return false;
    const session = db
      .select({ projectId: agentSessions.projectId })
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .get();
    return session?.projectId === projectId;
  });
  if (!remaining && !remainingInMemory) {
    activeAgentProjects.delete(projectId);
  }
}

export function syncProjectAgentLock(projectId: string): void {
  markAgentSessionIdle("", projectId);
}

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
    transition(session.id, { type: "deploy_ok" }, {
      commitSha: update.targetCommitSha ?? session.commitSha,
    });
  } else {
    const message = update.errorMessage ?? `Forge update ${update.status}`;
    appendSessionLog(session.id, `Forge self-update failed: ${message}`);
    transition(session.id, { type: "deploy_fail", errorMessage: message });
  }

  syncProjectAgentLock(session.projectId);
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
    transition(session.id, { type: "deploy_ok" });
  } else {
    const message = deployment.errorMessage ?? "Deployment failed";
    appendSessionLog(session.id, `Deployment failed: ${message}`);
    transition(session.id, { type: "deploy_fail", errorMessage: message });
  }

  syncProjectAgentLock(session.projectId);
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
    if (activeAgentSessions.has(session.id)) continue;
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
      transition(session.id, { type: "turn_complete" });
      reconciled += 1;
      continue;
    }

    const container = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, session.id))
      .get();
    const hasActiveRuntime = sessionHasLiveRuntime({
      containerStatus: container?.status ?? null,
      lastHeartbeatAt: container?.lastHeartbeatAt ?? null,
      lastActivityAt: container?.lastActivityAt ?? null,
      sessionStartedAt: session.startedAt,
    });
    const stuck = isStuckActiveSession({
      status: session.status,
      failedTurnStartSeq: session.failedTurnStartSeq,
      hasActiveRuntime,
      projectMarkedActive: hasActiveRuntime,
      turnIncomplete,
    });
    if (!stuck) continue;

    const message =
      session.status === "pending"
        ? "Agent session did not start (orchestrator restarted or session interrupted)"
        : "Agent session interrupted";

    appendSessionLog(session.id, message);
    transition(session.id, { type: "fail", errorMessage: message });
    reconciled += 1;
  }

  if (reconciled > 0) {
    syncProjectAgentLock(projectId);
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

    const turnIncomplete = !isAgentTurnComplete(sessionEvents(session.id));
    if (
      !shouldFailStoppedContainer({
        sessionStatus: session.status,
        containerStatus: container.status,
        killReason: container.killReason,
        turnIncomplete,
      })
    ) {
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
    if (container.killReason) {
      transition(session.id, { type: "kill", reason: container.killReason });
    } else {
      transition(session.id, { type: "fail", errorMessage: message });
    }
    syncProjectAgentLock(projectId);
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

    const state = await inspectAgentContainerState(session.id);
    if (state.running !== false) continue;

    const message =
      "Agent container missing from runtime; session failed by reconcile";
    setAgentContainerKillReason(session.id, "reconcile_missing");
    try {
      await removeAgentContainer(session.id);
    } catch {
      // ignore
    }
    appendSessionLog(session.id, message);
    transition(session.id, { type: "fail", errorMessage: message });
    syncProjectAgentLock(session.projectId);
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

  if (row) return true;
  return [...activeAgentSessions].some((id) => {
    const session = db
      .select({ projectId: agentSessions.projectId })
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .get();
    return session?.projectId === projectId;
  });
}

export function isAgentSessionActiveOnBranch(
  projectId: string,
  branch: string,
): boolean {
  return Boolean(getActiveSessionForBranch(projectId, branch));
}

export function getActiveSessionForBranch(projectId: string, branch: string) {
  reconcileProjectAgentSessions(projectId);

  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.branch, branch),
        inArray(agentSessions.status, [...ACTIVE_STATUSES]),
        isNull(agentSessions.completedAt),
        isNull(agentSessions.archivedAt),
      ),
    )
    .orderBy(desc(agentSessions.startedAt))
    .limit(1)
    .get();
}

export function listActiveSessionsForProject(projectId: string) {
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
    .all();
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
