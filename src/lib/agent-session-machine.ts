import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  type AgentKillReason,
  type AgentSessionStatus,
} from "@/lib/db/schema";
import {
  operatorStopError,
  type OperatorStopReason,
} from "@/lib/agent-session-events";

export type { OperatorStopReason };
export {
  OPERATOR_STOP_PREFIX,
  operatorStopError,
  isOperatorStopError,
} from "@/lib/agent-session-events";

export type SessionEvent =
  | { type: "queue" }
  | { type: "start" }
  | { type: "run" }
  | { type: "turn_complete" }
  | { type: "deploy_start"; deploymentId?: string }
  | { type: "deploy_ok" }
  | { type: "deploy_fail"; errorMessage: string }
  | { type: "operator_stop"; reason: OperatorStopReason }
  | { type: "kill"; reason: AgentKillReason }
  | { type: "fail"; errorMessage: string }
  | { type: "archive" };

export type SessionPatch = {
  cursorSessionId?: string;
  errorMessage?: string | null;
  completedAt?: Date | null;
  deploymentId?: string | null;
  commitSha?: string | null;
  archivedAt?: Date | null;
};

const TERMINAL: ReadonlySet<AgentSessionStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

function nextStatus(event: SessionEvent): AgentSessionStatus {
  switch (event.type) {
    case "queue":
      return "queued";
    case "start":
      return "pending";
    case "run":
      return "running";
    case "turn_complete":
      return "completed";
    case "deploy_start":
      return "deploying";
    case "deploy_ok":
      return "completed";
    case "deploy_fail":
      return "failed";
    case "operator_stop":
      if (event.reason === "cancel") return "cancelled";
      if (event.reason === "end") return "completed";
      return "failed";
    case "kill":
      return "failed";
    case "fail":
      return "failed";
    case "archive":
      return "failed";
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function extrasForEvent(event: SessionEvent): SessionPatch {
  const now = new Date();
  switch (event.type) {
    case "turn_complete":
    case "deploy_ok":
      return { completedAt: now, errorMessage: null };
    case "deploy_start":
      return event.deploymentId
        ? { deploymentId: event.deploymentId, completedAt: null }
        : { completedAt: null };
    case "deploy_fail":
      return { completedAt: now, errorMessage: event.errorMessage };
    case "operator_stop":
      return {
        completedAt: now,
        errorMessage: operatorStopError(event.reason),
      };
    case "kill":
      return {
        completedAt: now,
        errorMessage: `Agent container stopped (${event.reason})`,
      };
    case "fail":
      return { completedAt: now, errorMessage: event.errorMessage };
    case "archive":
      return { archivedAt: now, completedAt: now };
    case "queue":
    case "start":
    case "run":
      return { completedAt: null };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Only writer of agent_sessions.status.
 * Archive may keep the current status and only set archivedAt when already terminal.
 */
export function transition(
  sessionId: string,
  event: SessionEvent,
  extra?: SessionPatch,
): void {
  const row = db
    .select({ status: agentSessions.status })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  if (!row) throw new Error("Session not found");

  const patch: SessionPatch & { status?: AgentSessionStatus } = {
    ...extrasForEvent(event),
    ...extra,
  };

  if (event.type === "archive") {
    patch.archivedAt = extra?.archivedAt ?? new Date();
    if (!TERMINAL.has(row.status)) {
      patch.status = "failed";
      patch.completedAt = patch.completedAt ?? new Date();
    }
  } else {
    patch.status = nextStatus(event);
  }

  db.update(agentSessions)
    .set(patch)
    .where(eq(agentSessions.id, sessionId))
    .run();
}

/** Non-status field updates (cursor id, deployment id, commit sha). */
export function patchAgentSession(sessionId: string, extra: SessionPatch): void {
  db.update(agentSessions).set(extra).where(eq(agentSessions.id, sessionId)).run();
}

export function shouldFailStoppedContainer(input: {
  sessionStatus: string;
  containerStatus: string;
  killReason: string | null;
  turnIncomplete: boolean;
}): boolean {
  if (
    input.containerStatus !== "stopped" &&
    input.containerStatus !== "removed"
  ) {
    return false;
  }
  if (input.killReason) return true;
  if (input.sessionStatus === "deploying") return false;
  if (input.sessionStatus === "running") return false;
  if (input.sessionStatus === "pending") return true;
  return false;
}
