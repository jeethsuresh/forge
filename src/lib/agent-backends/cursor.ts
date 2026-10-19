import { existsSync } from "fs";
import { join } from "path";
import type {
  AgentBackend,
  AgentTurnContext,
} from "@/lib/agent-backends/types";
import { pickCursorThinkingModel } from "@/lib/agent-backends/thinking";
import {
  asStreamLine,
  parseJsonObject,
  sessionIdFromCursorEvent,
} from "@/lib/agent-backends/stream";
import { resolveForgeHostMounts } from "@/lib/forge-host-mounts";
import { backendApiKey } from "@/lib/agent-backends/settings";

export const CURSOR_INSIDE_DIR = "/opt/cursor-agent";

export function cursorHostDir(): string | undefined {
  return resolveForgeHostMounts().cursorAgentDir?.trim() || undefined;
}

export function cursorBinaryName(hostDir: string): "cursor-agent" | "agent" {
  if (existsSync(join(hostDir, "cursor-agent"))) return "cursor-agent";
  if (existsSync(join(hostDir, "agent"))) return "agent";
  return "cursor-agent";
}

export function cursorBinInside(hostDir?: string): string {
  const name = hostDir ? cursorBinaryName(hostDir) : "cursor-agent";
  return `${CURSOR_INSIDE_DIR}/${name}`;
}

function cursorCliPresent(): boolean {
  const dir = cursorHostDir();
  if (!dir) return false;
  return (
    existsSync(join(dir, "cursor-agent")) || existsSync(join(dir, "agent"))
  );
}

export const cursorBackend: AgentBackend = {
  id: "cursor",
  displayName: "Cursor",
  isAvailable() {
    return cursorCliPresent() && Boolean(backendApiKey("cursor"));
  },
  unavailableReason() {
    if (!cursorCliPresent()) {
      return "Cursor CLI not found on the host. Install the agent CLI or set FORGE_CURSOR_AGENT_DIR.";
    }
    if (!backendApiKey("cursor")) {
      return "Cursor credentials missing. Set FORGE_CURSOR_API_KEY or run agent login on the host.";
    }
    return null;
  },
  resolveThinking(model) {
    return pickCursorThinkingModel(model);
  },
  containerSpec(turn: AgentTurnContext) {
    const hostDir = cursorHostDir();
    const args = [
      "-p",
      "--force",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      ...turn.thinking.extraArgs,
    ];
    if (turn.resumeSessionId?.trim()) {
      args.push("--resume", turn.resumeSessionId.trim());
    }
    const env: Record<string, string> = {
      FORGE_AGENT_BACKEND: "cursor",
      FORGE_AGENT_BIN: cursorBinInside(hostDir),
      FORGE_AGENT_ARGS_JSON: JSON.stringify(args),
    };
    if (turn.thinking.level) env.FORGE_AGENT_THINKING = turn.thinking.level;
    if (turn.thinking.modelId) env.FORGE_AGENT_MODEL = turn.thinking.modelId;
    const apiKey = turn.apiKey ?? backendApiKey("cursor");
    if (apiKey) env.CURSOR_API_KEY = apiKey;
    const binds: string[] = [];
    if (hostDir && cursorCliPresent()) {
      binds.push(`${hostDir}:${CURSOR_INSIDE_DIR}:ro,z`);
    }
    return {
      env,
      binds,
      agentBin: cursorBinInside(hostDir),
      args,
    };
  },
  parseVendorLine(line) {
    const event = parseJsonObject(line);
    if (!event) {
      return asStreamLine({ type: "stream", line });
    }
    return asStreamLine(event, sessionIdFromCursorEvent(event));
  },
};
