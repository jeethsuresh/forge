export const TERMINAL_SESSION_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;

export type TerminalSessionStatus = (typeof TERMINAL_SESSION_STATUSES)[number];

export function isTerminalSessionStatus(status: string): status is TerminalSessionStatus {
  return (TERMINAL_SESSION_STATUSES as readonly string[]).includes(status);
}

/** Clear optimistic busy when the server reports a terminal session. */
export function reconcileAgentBusy(
  agentBusy: boolean,
  sessionStatus: string,
): boolean {
  if (isTerminalSessionStatus(sessionStatus)) return false;
  return agentBusy;
}

export type AgentSessionBannerKind = "working" | "failed" | null;

export interface AgentSessionBannerInput {
  status: string;
  agentBusy: boolean;
  isDeploying: boolean;
  errorMessage: string | null;
  failedTurnStartSeq: number | null;
}

export interface AgentSessionBanner {
  kind: NonNullable<AgentSessionBannerKind>;
  text: string;
  canRetry?: boolean;
}

/** UI banner from session status; terminal states win over stale agentBusy. */
export function resolveAgentSessionBanner(
  input: AgentSessionBannerInput,
): AgentSessionBanner | null {
  const { status, agentBusy, isDeploying, errorMessage, failedTurnStartSeq } =
    input;

  if (isDeploying) {
    return { kind: "working", text: "Rebuilding and releasing containers…" };
  }

  if (status === "failed") {
    return {
      kind: "failed",
      text: errorMessage ?? "Agent session failed",
      canRetry: failedTurnStartSeq != null,
    };
  }

  if (isTerminalSessionStatus(status)) {
    return null;
  }

  if (agentBusy || status === "running" || status === "pending") {
    if (status === "pending") {
      return { kind: "working", text: "Starting agent session…" };
    }
    return { kind: "working", text: "Agent is working…" };
  }

  return null;
}

export interface StuckSessionInput {
  status: string;
  failedTurnStartSeq: number | null;
  hasActiveProcess: boolean;
  projectMarkedActive: boolean;
}

/** Detect sessions stuck active in DB after the agent process has ended. */
export function isStuckActiveSession(input: StuckSessionInput): boolean {
  const { status, failedTurnStartSeq, hasActiveProcess, projectMarkedActive } =
    input;

  if (hasActiveProcess) return false;

  if (status === "running" && failedTurnStartSeq != null) {
    return true;
  }

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
