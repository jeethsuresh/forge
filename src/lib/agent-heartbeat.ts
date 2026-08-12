import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentContainers,
  agentSessions,
  type AgentKillReason,
} from "@/lib/db/schema";
import {
  removeAgentContainer,
  setAgentContainerKillReason,
  stopAgentContainer,
} from "@/lib/agent-container";
import { activeAgentProjects } from "@/lib/agent-state";

/** Spec defaults for agent container kill policy (design §3). */
export const AGENT_HEARTBEAT_INTERVAL_SEC = 10;
export const AGENT_HEARTBEAT_MISS_THRESHOLD = 3;
export const AGENT_IDLE_MS = 30 * 60 * 1000;
export const AGENT_WALL_CLOCK_MS = 2 * 60 * 60 * 1000;

const KILL_TICK_MS = 5_000;

declare global {
  var __forgeAgentKillPolicyStarted: boolean | undefined;
  var __forgeAgentKillPolicyTimer: ReturnType<typeof setInterval> | undefined;
}

/** Miss window: interval × threshold (e.g. 10s × 3 = 30s without heartbeat). */
export function agentHeartbeatMissWindowMs(
  intervalSec = AGENT_HEARTBEAT_INTERVAL_SEC,
  threshold = AGENT_HEARTBEAT_MISS_THRESHOLD,
): number {
  return intervalSec * threshold * 1000;
}

export function recordAgentHeartbeat(
  sessionId: string,
  now: Date = new Date(),
): void {
  const row = db
    .select()
    .from(agentContainers)
    .where(eq(agentContainers.sessionId, sessionId))
    .get();
  if (!row) return;

  db.update(agentContainers)
    .set({ lastHeartbeatAt: now })
    .where(eq(agentContainers.sessionId, sessionId))
    .run();
}

export function recordAgentActivity(
  sessionId: string,
  now: Date = new Date(),
): void {
  const row = db
    .select()
    .from(agentContainers)
    .where(eq(agentContainers.sessionId, sessionId))
    .get();
  if (!row) return;

  db.update(agentContainers)
    .set({ lastActivityAt: now, lastHeartbeatAt: now })
    .where(eq(agentContainers.sessionId, sessionId))
    .run();
}

export type AgentKillVerdict = {
  sessionId: string;
  reason: AgentKillReason;
};

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

export function reasonForAgentKill(
  container: {
    lastHeartbeatAt: Date | null;
    lastActivityAt: Date | null;
    startedAt: Date;
    deadlineAt: Date;
  },
  now: Date,
): AgentKillReason | null {
  if (now.getTime() >= container.deadlineAt.getTime()) {
    return "wall_clock";
  }

  const activityAt = container.lastActivityAt ?? container.startedAt;
  if (now.getTime() - activityAt.getTime() >= AGENT_IDLE_MS) {
    return "idle_timeout";
  }

  const heartbeatAt = container.lastHeartbeatAt ?? container.startedAt;
  if (now.getTime() - heartbeatAt.getTime() >= agentHeartbeatMissWindowMs()) {
    return "heartbeat_miss";
  }

  return null;
}

async function applyAgentKill(
  sessionId: string,
  reason: AgentKillReason,
): Promise<void> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  if (!session) return;
  if (
    session.status === "completed" ||
    session.status === "failed" ||
    session.status === "cancelled"
  ) {
    return;
  }

  const message =
    reason === "heartbeat_miss"
      ? "Agent container killed: heartbeat miss threshold exceeded"
      : reason === "idle_timeout"
        ? "Agent container killed: idle timeout exceeded"
        : reason === "wall_clock"
          ? "Agent container killed: wall-clock max exceeded"
          : `Agent container killed: ${reason}`;

  setAgentContainerKillReason(sessionId, reason);
  try {
    await stopAgentContainer(sessionId);
  } catch {
    // ignore
  }
  try {
    await removeAgentContainer(sessionId);
  } catch {
    // ignore
  }

  appendSessionLog(sessionId, message);
  db.update(agentSessions)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: message,
    })
    .where(eq(agentSessions.id, sessionId))
    .run();

  activeAgentProjects.delete(session.projectId);
}

/**
 * Evaluate kill policy for all running agent containers.
 * Returns sessions that were (or should be) killed.
 */
export async function evaluateAgentKillPolicy(
  now: Date = new Date(),
): Promise<AgentKillVerdict[]> {
  const containers = db
    .select()
    .from(agentContainers)
    .where(inArray(agentContainers.status, ["starting", "running"]))
    .all();

  const verdicts: AgentKillVerdict[] = [];

  for (const container of containers) {
    const session = db
      .select()
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.id, container.sessionId),
          isNull(agentSessions.archivedAt),
        ),
      )
      .get();
    if (!session) continue;
    if (
      session.status !== "running" &&
      session.status !== "pending" &&
      session.status !== "deploying"
    ) {
      continue;
    }

    const reason = reasonForAgentKill(container, now);
    if (!reason) continue;

    verdicts.push({ sessionId: container.sessionId, reason });
    await applyAgentKill(container.sessionId, reason);
  }

  return verdicts;
}

export function startAgentKillPolicyTicker(): void {
  if (globalThis.__forgeAgentKillPolicyStarted) return;
  globalThis.__forgeAgentKillPolicyStarted = true;

  if (globalThis.__forgeAgentKillPolicyTimer) {
    clearInterval(globalThis.__forgeAgentKillPolicyTimer);
  }

  console.log(
    `[forge] Starting agent kill-policy ticker (tick every ${KILL_TICK_MS / 1000}s)`,
  );

  const tick = async () => {
    try {
      await evaluateAgentKillPolicy();
    } catch (err) {
      console.error("[forge] Agent kill-policy tick failed:", err);
    }
  };

  void tick();
  globalThis.__forgeAgentKillPolicyTimer = setInterval(tick, KILL_TICK_MS);
}
