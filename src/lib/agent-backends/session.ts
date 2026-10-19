import type { AgentBackendId, ThinkingLevel } from "@/lib/agent-backends/types";
import { parseAgentBackendId } from "@/lib/agent-backends/types";

export function sessionBackendId(session: {
  backend?: string | null;
}): AgentBackendId {
  return parseAgentBackendId(session.backend) ?? "cursor";
}

export function sessionResumeId(session: {
  resumeBackendSessionId?: string | null;
  backendSessionId?: string | null;
  resumeCursorSessionId?: string | null;
  cursorSessionId?: string | null;
}): string | null {
  return (
    session.resumeBackendSessionId ??
    session.backendSessionId ??
    session.resumeCursorSessionId ??
    session.cursorSessionId ??
    null
  );
}

export function resumeFieldsForSuccess(session: {
  backend?: string | null;
  backendSessionId?: string | null;
  cursorSessionId?: string | null;
}): {
  resumeBackendSessionId: string | null;
  resumeCursorSessionId: string | null;
} {
  const vendor =
    session.backendSessionId ?? session.cursorSessionId ?? null;
  const backend = sessionBackendId(session);
  return {
    resumeBackendSessionId: vendor,
    resumeCursorSessionId: backend === "cursor" ? vendor : null,
  };
}

export function thinkingLevelOrNull(
  value: string | null | undefined,
): ThinkingLevel | null {
  if (value === "xhigh" || value === "high" || value === "none") return value;
  return null;
}
