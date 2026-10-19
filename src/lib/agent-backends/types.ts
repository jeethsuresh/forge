export const AGENT_BACKEND_IDS = ["cursor", "codex", "local"] as const;

export type AgentBackendId = (typeof AGENT_BACKEND_IDS)[number];

export type ThinkingLevel = "xhigh" | "high" | "none";

export type ThinkingResolution = {
  level: ThinkingLevel;
  modelId?: string;
  extraArgs: string[];
  note?: string;
};

export type AgentBackendSettings = {
  backend: AgentBackendId;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  updatedAt: Date | null;
};

export type AgentTurnContext = {
  resumeSessionId?: string | null;
  thinking: ThinkingResolution;
  settings: AgentBackendSettings;
  apiKey?: string | null;
};

export type AgentContainerSpec = {
  env: Record<string, string>;
  binds: string[];
  agentBin: string;
  args: string[];
};

export type ParsedVendorLine = {
  eventType: string;
  line: string;
  vendorSessionId?: string;
};

export type AgentBackend = {
  id: AgentBackendId;
  displayName: string;
  isAvailable(): boolean;
  unavailableReason(): string | null;
  resolveThinking(model: string): ThinkingResolution;
  containerSpec(turn: AgentTurnContext): AgentContainerSpec;
  parseVendorLine(line: string): ParsedVendorLine | null;
};

export type AvailableBackendInfo = {
  id: AgentBackendId;
  displayName: string;
  available: boolean;
  reason: string | null;
};

export function isAgentBackendId(value: string | null | undefined): value is AgentBackendId {
  return (
    value === "cursor" || value === "codex" || value === "local"
  );
}

export function parseAgentBackendId(
  value: string | null | undefined,
): AgentBackendId | null {
  const trimmed = value?.trim();
  return isAgentBackendId(trimmed) ? trimmed : null;
}
