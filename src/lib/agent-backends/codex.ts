import { existsSync } from "fs";
import { join } from "path";
import type {
  AgentBackend,
  AgentTurnContext,
} from "@/lib/agent-backends/types";
import { codexReasoningArgs } from "@/lib/agent-backends/thinking";
import { asStreamLine, parseJsonObject } from "@/lib/agent-backends/stream";
import { resolveForgeHostMounts } from "@/lib/forge-host-mounts";
import { backendApiKey } from "@/lib/agent-backends/settings";

export const CODEX_INSIDE_DIR = "/opt/codex";
export const CODEX_INSIDE_BIN = "/opt/codex/codex";

export function codexHostDir(): string | undefined {
  const fromMounts = resolveForgeHostMounts().codexDir?.trim();
  if (fromMounts) return fromMounts;
  const fromEnv = process.env.FORGE_CODEX_DIR?.trim();
  return fromEnv || undefined;
}

function codexCliPresent(): boolean {
  const dir = codexHostDir();
  if (!dir) return false;
  return existsSync(join(dir, "codex"));
}

function stringField(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function translateCodexLine(line: string) {
  const event = parseJsonObject(line);
  if (!event) {
    return asStreamLine({ type: "assistant", message: { content: [{ type: "text", text: line }] } });
  }

  const type = typeof event.type === "string" ? event.type : "";
  const item =
    event.item && typeof event.item === "object"
      ? (event.item as Record<string, unknown>)
      : event;

  const threadId =
    stringField(event, "thread_id", "threadId", "session_id", "sessionId") ??
    stringField(item, "thread_id", "id");

  if (
    type === "thread.started" ||
    type === "session_created" ||
    type === "session.created"
  ) {
    return asStreamLine(
      { type: "system", subtype: "init", session_id: threadId ?? "" },
      threadId,
    );
  }

  const itemType = stringField(item, "type") ?? "";
  const text =
    stringField(item, "text", "message", "content") ??
    stringField(event, "text", "message");

  if (
    type.includes("reasoning") ||
    itemType.includes("reasoning") ||
    (type === "item.started" && itemType === "reasoning")
  ) {
    return asStreamLine(
      { type: "thinking", subtype: "delta", text: text ?? "" },
      threadId,
    );
  }

  if (itemType === "command_execution" || type.includes("command")) {
    const command = stringField(item, "command") ?? text ?? "shell";
    const status =
      type.includes("completed") || itemType.endsWith("completed")
        ? "completed"
        : "started";
    const callId = stringField(item, "id", "call_id") ?? "codex-shell";
    return asStreamLine(
      {
        type: "tool_call",
        subtype: status,
        call_id: callId,
        tool_call: {
          shellToolCall: {
            args: { command },
            result:
              status === "completed"
                ? {
                    success: {
                      stdout: stringField(item, "aggregated_output", "output") ?? "",
                      exitCode: typeof item.exit_code === "number" ? item.exit_code : 0,
                    },
                  }
                : undefined,
          },
        },
      },
      threadId,
    );
  }

  if (itemType === "agent_message" || type === "item.completed" || text) {
    return asStreamLine(
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: text ?? "" }],
        },
      },
      threadId,
    );
  }

  return asStreamLine({ type: "stream", ...event }, threadId);
}

export const codexBackend: AgentBackend = {
  id: "codex",
  displayName: "Codex",
  isAvailable() {
    return codexCliPresent() && Boolean(backendApiKey("codex"));
  },
  unavailableReason() {
    if (!codexCliPresent()) {
      return "Codex CLI not found on the host. Install Codex or set FORGE_CODEX_DIR.";
    }
    if (!backendApiKey("codex")) {
      return "Codex credentials missing. Add an OpenAI API key in Global settings → Agent backends.";
    }
    return null;
  },
  resolveThinking(model) {
    const trimmed = model.trim();
    return {
      level: "xhigh",
      modelId: trimmed || undefined,
      extraArgs: [
        ...(trimmed ? ["--model", trimmed] : []),
        ...codexReasoningArgs("xhigh"),
      ],
    };
  },
  containerSpec(turn: AgentTurnContext) {
    const hostDir = codexHostDir();
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      ...turn.thinking.extraArgs,
    ];
    if (turn.resumeSessionId?.trim()) {
      args.push("resume", turn.resumeSessionId.trim());
    }
    const env: Record<string, string> = {
      FORGE_AGENT_BACKEND: "codex",
      FORGE_AGENT_BIN: CODEX_INSIDE_BIN,
      FORGE_AGENT_ARGS_JSON: JSON.stringify(args),
      FORGE_AGENT_THINKING: turn.thinking.level,
    };
    if (turn.thinking.modelId) env.FORGE_AGENT_MODEL = turn.thinking.modelId;
    const apiKey = turn.apiKey ?? backendApiKey("codex");
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
      env.CODEX_API_KEY = apiKey;
    }
    const binds: string[] = [];
    if (hostDir && codexCliPresent()) {
      binds.push(`${hostDir}:${CODEX_INSIDE_DIR}:ro,z`);
    }
    return {
      env,
      binds,
      agentBin: CODEX_INSIDE_BIN,
      args,
    };
  },
  parseVendorLine: translateCodexLine,
};
