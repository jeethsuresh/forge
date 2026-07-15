export const RECOVERY_PROMPT_PREFIX = "[deploy-recovery]";
export const REBASE_RECOVERY_PROMPT_PREFIX = "[rebase-recovery]";

export function isRecoveryPrompt(prompt: string): boolean {
  return prompt.startsWith(RECOVERY_PROMPT_PREFIX);
}

export function isRebaseRecoveryPrompt(prompt: string): boolean {
  return prompt.startsWith(REBASE_RECOVERY_PROMPT_PREFIX);
}

export type AgentSessionSource = "manual" | "recovery" | "rebase-recovery";

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
    session.source === "manual"
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

/** Recovery turns are one-shot; auto-complete when the turn ends so they do not block new agents. */
export function shouldAutoCompleteRecoverySession(session: {
  source?: AgentSessionSource | string | null;
  initialPrompt: string;
}): boolean {
  const source = resolveAgentSessionSource(session);
  return source === "recovery" || source === "rebase-recovery";
}

export function agentSessionSourceLabel(source: AgentSessionSource): string {
  if (source === "recovery") return "Deploy recovery";
  if (source === "rebase-recovery") return "Rebase recovery";
  return "Manual";
}

export function agentSessionSourceBadgeClass(source: AgentSessionSource): string {
  if (source === "recovery") {
    return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  }
  if (source === "rebase-recovery") {
    return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  }
  return "border-orange-400/20 bg-orange-400/10 text-orange-300";
}

/** Session is waiting for the user to send a first message — does not block deploys. */
export function isIdleAgentSession(status: string): boolean {
  return status === "idle";
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
