import { isOperatorStopError } from "@/lib/agent-session-events";

export const RECOVERY_PROMPT_PREFIX = "[deploy-recovery]";
export const REBASE_RECOVERY_PROMPT_PREFIX = "[rebase-recovery]";

export function isRecoveryPrompt(prompt: string): boolean {
  return prompt.startsWith(RECOVERY_PROMPT_PREFIX);
}

export function isRebaseRecoveryPrompt(prompt: string): boolean {
  return prompt.startsWith(REBASE_RECOVERY_PROMPT_PREFIX);
}

export type AgentSessionSource =
  | "manual"
  | "recovery"
  | "rebase-recovery"
  | "ticket";

export interface RebaseRecoveryContext {
  projectId: string;
  sourceBranch: string;
  ontoBranch: string;
  recoveryBranch: string;
  errorMessage: string;
}

export function resolveAgentSessionSource(session: {
  source?: AgentSessionSource | string | null;
  initialPrompt: string;
}): AgentSessionSource {
  if (
    session.source === "recovery" ||
    session.source === "rebase-recovery" ||
    session.source === "manual" ||
    session.source === "ticket"
  ) {
    return session.source;
  }
  if (session.initialPrompt.startsWith(REBASE_RECOVERY_PROMPT_PREFIX)) {
    return "rebase-recovery";
  }
  return session.initialPrompt.startsWith(RECOVERY_PROMPT_PREFIX)
    ? "recovery"
    : "manual";
}

/** Deploy/rebase recovery sessions are one-shot and must not block new agents on the branch. */
export function shouldAutoCompleteRecoverySession(session: {
  source?: AgentSessionSource | string | null;
  initialPrompt: string;
}): boolean {
  const source = resolveAgentSessionSource(session);
  return source === "recovery" || source === "rebase-recovery";
}

/** True when the operator stopped/ended/cancelled the recovery agent. */
export function isRecoveryAbortedByUser(session: {
  status: string;
  errorMessage?: string | null;
  logs?: string | null;
}): boolean {
  if (session.status === "cancelled") return true;
  return isOperatorStopError(session.errorMessage);
}

export function agentSessionSourceLabel(source: AgentSessionSource): string {
  switch (source) {
    case "recovery":
      return "Deploy recovery";
    case "rebase-recovery":
      return "Rebase recovery";
    case "ticket":
      return "Ticket";
    case "manual":
      return "Manual";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

export function agentSessionSourceBadgeClass(source: AgentSessionSource): string {
  switch (source) {
    case "recovery":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "rebase-recovery":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
    case "ticket":
      return "border-violet-400/30 bg-violet-400/10 text-violet-200";
    case "manual":
      return "border-orange-400/20 bg-orange-400/10 text-orange-300";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/** Session is waiting for the user to send a first message — does not block deploys. */
export function isIdleAgentSession(status: string): boolean {
  return status === "idle";
}

/** Session is waiting in the project agent queue — does not require a live process. */
export function isQueuedAgentSessionStatus(status: string): boolean {
  return status === "queued";
}

/** UI treats these as inactive for follow-up vs new-message forms. */
export const INACTIVE_AGENT_SESSION_STATUSES = [
  "idle",
  "queued",
  "completed",
  "failed",
  "cancelled",
] as const;

export function isInactiveAgentSessionStatus(status: string): boolean {
  return (INACTIVE_AGENT_SESSION_STATUSES as readonly string[]).includes(status);
}
