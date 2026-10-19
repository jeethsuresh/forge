import type { AgentBackend, AgentTurnContext } from "@/lib/agent-backends/types";
import { getBackendSettings, backendApiKey } from "@/lib/agent-backends/settings";
import { asStreamLine, parseJsonObject } from "@/lib/agent-backends/stream";

export const LOCAL_RUNTIME_BIN = "/usr/local/lib/forge-local-agent/run.mjs";

export const localBackend: AgentBackend = {
  id: "local",
  displayName: "Local",
  isAvailable() {
    const settings = getBackendSettings("local");
    return Boolean(settings.baseUrl && settings.model);
  },
  unavailableReason() {
    const settings = getBackendSettings("local");
    if (!settings.baseUrl) {
      return "Local agent base URL is not set. Add it in Global settings → Agent backends.";
    }
    if (!settings.model) {
      return "Local agent model is not set. Add it in Global settings → Agent backends.";
    }
    return null;
  },
  resolveThinking(model) {
    return {
      level: "xhigh",
      modelId: model.trim() || getBackendSettings("local").model,
      extraArgs: [],
      note: "Local runtime sends reasoning.effort=xhigh then high; omits it if the API rejects reasoning.",
    };
  },
  containerSpec(turn: AgentTurnContext) {
    const settings = turn.settings.baseUrl
      ? turn.settings
      : getBackendSettings("local");
    const env: Record<string, string> = {
      FORGE_AGENT_BACKEND: "local",
      FORGE_AGENT_BIN: LOCAL_RUNTIME_BIN,
      FORGE_AGENT_ARGS_JSON: JSON.stringify([]),
      FORGE_LOCAL_BASE_URL: settings.baseUrl,
      FORGE_LOCAL_MODEL: turn.thinking.modelId || settings.model,
      FORGE_AGENT_THINKING: turn.thinking.level,
    };
    const apiKey = turn.apiKey ?? backendApiKey("local");
    if (apiKey) env.FORGE_LOCAL_API_KEY = apiKey;
    return {
      env,
      binds: [],
      agentBin: LOCAL_RUNTIME_BIN,
      args: [],
    };
  },
  parseVendorLine(line) {
    const event = parseJsonObject(line);
    if (!event) return asStreamLine({ type: "stream", line });
    const sessionId =
      typeof event.session_id === "string" ? event.session_id : undefined;
    return asStreamLine(event, sessionId);
  },
};
