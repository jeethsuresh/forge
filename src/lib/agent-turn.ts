import { eventsOutsideContextCompaction } from "@/lib/agent-context";

export const TERMINAL_SESSION_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;

export type TerminalSessionStatus = (typeof TERMINAL_SESSION_STATUSES)[number];

export function isTerminalSessionStatus(status: string): status is TerminalSessionStatus {
  return (TERMINAL_SESSION_STATUSES as readonly string[]).includes(status);
}

export function isAgentTurnComplete(events: AgentEventRow[]): boolean {
  const visible = eventsOutsideContextCompaction(events);
  let lastUserSeq = 0;
  for (const event of visible) {
    if (event.eventType === "user") lastUserSeq = event.seq;
  }
  if (lastUserSeq === 0) return true;
  return visible.some(
    (event) => event.seq > lastUserSeq && event.eventType === "result",
  );
}

/** UI banner from session status. Agent "working" only when a process is live. */
export function resolveAgentSessionBanner(
  input: AgentSessionBannerInput,
): AgentSessionBanner | null {
  const { status, isDeploying, errorMessage, canRetry } = input;
  const hasActiveRuntime = input.hasActiveRuntime ?? input.hasActiveProcess ?? false;

  if (isDeploying) {
    return { kind: "working", text: "Rebuilding and releasing containers…" };
  }

  if (input.compactingLearnings) {
    return { kind: "working", text: "Compacting learnings…" };
  }

  if (status === "failed") {
    return {
      kind: "failed",
      text: errorMessage ?? "Agent session failed",
      canRetry,
    };
  }

  if (isTerminalSessionStatus(status)) {
    return null;
  }

  if (hasActiveRuntime) {
    return { kind: "working", text: "Agent is working…" };
  }

  return null;
}

export type AgentSessionBannerKind = "working" | "failed" | null;

export interface AgentSessionBannerInput {
  status: string;
  hasActiveRuntime?: boolean;
  /** @deprecated Use hasActiveRuntime */
  hasActiveProcess?: boolean;
  isDeploying: boolean;
  errorMessage: string | null;
  canRetry: boolean;
  compactingLearnings?: boolean;
}

export interface AgentSessionBanner {
  kind: NonNullable<AgentSessionBannerKind>;
  text: string;
  canRetry?: boolean;
}

export interface StuckSessionInput {
  status: string;
  failedTurnStartSeq: number | null;
  hasActiveRuntime?: boolean;
  /** @deprecated Use hasActiveRuntime */
  hasActiveProcess?: boolean;
  projectMarkedActive: boolean;
  turnIncomplete?: boolean;
}

/** Align with agentHeartbeatMissWindowMs (10s interval × 3 misses). */
export const DEFAULT_HEARTBEAT_MISS_WINDOW_MS = 30_000;
/** Git fetch + docker run can take longer than one UI poll. */
export const AGENT_STARTUP_GRACE_MS = 120_000;

export interface LiveRuntimeInput {
  containerStatus?: string | null;
  lastHeartbeatAt?: Date | null;
  lastActivityAt?: Date | null;
  sessionStartedAt: Date;
  now?: Date;
  heartbeatMissWindowMs?: number;
  startupGraceMs?: number;
}

/**
 * Whether poll-time reconcile should treat the session as still live.
 * Container row / heartbeat are source of truth; the in-memory Set is not.
 */
export function sessionHasLiveRuntime(input: LiveRuntimeInput): boolean {
  if (
    input.containerStatus === "starting" ||
    input.containerStatus === "running"
  ) {
    return true;
  }

  const now = input.now ?? new Date();
  const miss = input.heartbeatMissWindowMs ?? DEFAULT_HEARTBEAT_MISS_WINDOW_MS;
  const beat = input.lastHeartbeatAt ?? input.lastActivityAt;
  if (beat && now.getTime() - beat.getTime() < miss) {
    return true;
  }

  if (input.containerStatus) {
    return false;
  }

  const grace = input.startupGraceMs ?? AGENT_STARTUP_GRACE_MS;
  return now.getTime() - input.sessionStartedAt.getTime() < grace;
}

/** Detect sessions stuck active in DB after the agent runtime has ended. */
export function isStuckActiveSession(input: StuckSessionInput): boolean {
  const { status, projectMarkedActive } = input;
  const hasActiveRuntime = input.hasActiveRuntime ?? input.hasActiveProcess ?? false;

  if (hasActiveRuntime) return false;

  // Per-turn containers exit on purpose (question, CLI finish, Forge restart).
  // Running sessions stay running so the user can send a follow-up.
  if (status === "running") return false;

  if (status === "pending" && !projectMarkedActive) {
    return true;
  }

  return false;
}

/** Stored user event shape from agent-runner (not stream-json). */
export interface StoredUserEvent {
  type: "user";
  text: string;
}

export interface AgentEventRow {
  seq: number;
  eventType: string;
  payload: string;
}

export function parseStoredUserEventPrompt(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as Partial<StoredUserEvent>;
    if (parsed.type === "user" && typeof parsed.text === "string" && parsed.text.trim()) {
      return parsed.text.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

/** Prompt for the failed turn, using failedTurnStartSeq when set. */
export function findFailedTurnPrompt(
  events: AgentEventRow[],
  failedTurnStartSeq: number | null | undefined,
): string | null {
  if (failedTurnStartSeq != null) {
    const turnUser = events.find(
      (e) => e.seq === failedTurnStartSeq && e.eventType === "user",
    );
    const prompt = turnUser ? parseStoredUserEventPrompt(turnUser.payload) : null;
    if (prompt) return prompt;
  }

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.eventType !== "user") continue;
    const prompt = parseStoredUserEventPrompt(event.payload);
    if (prompt) return prompt;
  }

  return null;
}

/** Events at or after the failed turn boundary (for removal before retry). */
export function failedTurnEventSeq(
  events: AgentEventRow[],
  failedTurnStartSeq: number | null | undefined,
): number | null {
  if (failedTurnStartSeq != null) return failedTurnStartSeq;

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.eventType === "user") return event.seq;
  }

  return null;
}

export function filterEventsBeforeSeq(
  events: AgentEventRow[],
  fromSeq: number | null | undefined,
): AgentEventRow[] {
  if (fromSeq == null) return events;
  return events.filter((e) => e.seq < fromSeq);
}

export function isSessionTurnFailed(status: string): boolean {
  return status === "failed";
}

/** Whether a failed session can retry the last agent prompt (not a deploy failure). */
export function canRetryFailedAgentTurn(
  session: {
    status: string;
    failedTurnStartSeq: number | null;
    deploymentId: string | null;
  },
  events: AgentEventRow[],
): boolean {
  if (session.status !== "failed") return false;
  if (!findFailedTurnPrompt(events, session.failedTurnStartSeq)) return false;
  if (session.deploymentId && isAgentTurnComplete(events)) return false;
  return true;
}
