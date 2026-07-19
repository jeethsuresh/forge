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
  let lastUserSeq = 0;
  for (const event of events) {
    if (event.eventType === "user") lastUserSeq = event.seq;
  }
  if (lastUserSeq === 0) return true;
  return events.some(
    (event) => event.seq > lastUserSeq && event.eventType === "result",
  );
}

/** UI banner from session status. Agent "working" only when a process is live. */
export function resolveAgentSessionBanner(
  input: AgentSessionBannerInput,
): AgentSessionBanner | null {
  const { status, hasActiveProcess, isDeploying, errorMessage, canRetry } =
    input;

  if (isDeploying) {
    return { kind: "working", text: "Rebuilding and releasing containers…" };
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

  if (hasActiveProcess) {
    return { kind: "working", text: "Agent is working…" };
  }

  return null;
}

export type AgentSessionBannerKind = "working" | "failed" | null;

export interface AgentSessionBannerInput {
  status: string;
  hasActiveProcess: boolean;
  isDeploying: boolean;
  errorMessage: string | null;
  canRetry: boolean;
}

export interface AgentSessionBanner {
  kind: NonNullable<AgentSessionBannerKind>;
  text: string;
  canRetry?: boolean;
}

export interface StuckSessionInput {
  status: string;
  failedTurnStartSeq: number | null;
  hasActiveProcess: boolean;
  projectMarkedActive: boolean;
  turnIncomplete?: boolean;
}

/** User-facing message when a session is reconciled as failed after restart. */
export function staleAgentSessionFailureMessage(
  status: "pending" | "running",
  options?: { isRecovery?: boolean },
): string {
  if (status === "pending") {
    return "Agent session did not start (orchestrator restarted before the turn began)";
  }

  if (options?.isRecovery) {
    return "Recovery agent turn did not finish (orchestrator restarted or the agent process exited). Review workspace for uncommitted changes, then retry or end the session.";
  }

  return "Agent turn did not finish (orchestrator restarted or the agent process exited). Use Retry to run the prompt again.";
}

/** Detect sessions stuck active in DB after the agent process has ended. */
export function isStuckActiveSession(input: StuckSessionInput): boolean {
  const {
    status,
    hasActiveProcess,
    projectMarkedActive,
    turnIncomplete = false,
  } = input;

  if (hasActiveProcess) return false;

  if (status === "running" && turnIncomplete) {
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
