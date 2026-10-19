import type {
  AgentBackend,
  AgentBackendId,
  AvailableBackendInfo,
} from "@/lib/agent-backends/types";
import { AGENT_BACKEND_IDS, isAgentBackendId } from "@/lib/agent-backends/types";
import { cursorBackend } from "@/lib/agent-backends/cursor";
import { codexBackend } from "@/lib/agent-backends/codex";
import { localBackend } from "@/lib/agent-backends/local";

const BACKENDS: Record<AgentBackendId, AgentBackend> = {
  cursor: cursorBackend,
  codex: codexBackend,
  local: localBackend,
};

export function getBackend(id: AgentBackendId): AgentBackend {
  return BACKENDS[id];
}

export function listBackends(): AgentBackend[] {
  return AGENT_BACKEND_IDS.map((id) => BACKENDS[id]);
}

export function listAvailableBackendInfo(): AvailableBackendInfo[] {
  return listBackends().map((backend) => ({
    id: backend.id,
    displayName: backend.displayName,
    available: backend.isAvailable(),
    reason: backend.unavailableReason(),
  }));
}

export function pickDefaultBackend(): AgentBackendId | null {
  for (const id of AGENT_BACKEND_IDS) {
    if (BACKENDS[id].isAvailable()) return id;
  }
  return null;
}

export function requireBackend(id: AgentBackendId): AgentBackend {
  const backend = BACKENDS[id];
  if (!backend.isAvailable()) {
    throw new Error(
      backend.unavailableReason() ??
        `Agent backend "${id}" is not available.`,
    );
  }
  return backend;
}

export function resolveRequestedBackend(
  requested?: string | null,
  options?: { requireAvailable?: boolean },
): AgentBackendId {
  const requestedId = requested?.trim() ?? "";
  if (requestedId) {
    if (!isAgentBackendId(requestedId)) {
      throw new Error(
        `Unknown agent backend "${requested}". Use cursor, codex, or local.`,
      );
    }
    if (options?.requireAvailable !== false) {
      requireBackend(requestedId);
    }
    return requestedId;
  }
  return pickDefaultBackend() ?? "cursor";
}
