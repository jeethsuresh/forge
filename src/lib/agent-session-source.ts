export const RECOVERY_PROMPT_PREFIX = "[deploy-recovery]";

export function isRecoveryPrompt(prompt: string): boolean {
  return prompt.startsWith(RECOVERY_PROMPT_PREFIX);
}

export type AgentSessionSource = "manual" | "recovery";

export function resolveAgentSessionSource(session: {
  source?: AgentSessionSource | string | null;
  initialPrompt: string;
}): AgentSessionSource {
  if (session.source === "recovery" || session.source === "manual") {
    return session.source;
  }
  return session.initialPrompt.startsWith(RECOVERY_PROMPT_PREFIX)
    ? "recovery"
    : "manual";
}

export function agentSessionSourceLabel(source: AgentSessionSource): string {
  return source === "recovery" ? "Deploy recovery" : "Manual";
}

export function agentSessionSourceBadgeClass(source: AgentSessionSource): string {
  return source === "recovery"
    ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
    : "border-orange-400/20 bg-orange-400/10 text-orange-300";
}

/** Session is waiting for the user to send a first message — does not block deploys. */
export function isIdleAgentSession(status: string): boolean {
  return status === "idle";
}

/** UI treats these as inactive for follow-up vs new-message forms. */
export const INACTIVE_AGENT_SESSION_STATUSES = [
  "idle",
  "completed",
  "failed",
  "cancelled",
] as const;

export function isInactiveAgentSessionStatus(status: string): boolean {
  return (INACTIVE_AGENT_SESSION_STATUSES as readonly string[]).includes(status);
}
