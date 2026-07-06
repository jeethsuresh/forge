export interface AgentDisplayMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  toolStatus?: "started" | "completed";
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolResultText?: string;
  toolStdout?: string;
  toolStderr?: string;
  toolDurationMs?: number;
  toolError?: string;
  timestamp: number;
}

export type AgentDisplayItem =
  | { kind: "message"; message: AgentDisplayMessage }
  | {
      kind: "tool-cluster";
      id: string;
      tools: AgentDisplayMessage[];
      hasActive: boolean;
    };

interface StreamEvent {
  type?: string;
  subtype?: string;
  call_id?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  text?: string;
  stdout?: string;
  stderr?: string;
  stream?: string;
  tool_call?: Record<string, unknown>;
  duration_ms?: number;
  timestamp_ms?: number;
}

interface ExtractedTool {
  name: string;
  callId?: string;
  status: "started" | "completed";
  args?: Record<string, unknown>;
  resultText?: string;
  stdout?: string;
  stderr?: string;
  errorText?: string;
  durationMs?: number;
  summary: string;
}

function parseToolCallMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function truncateText(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
}

function formatUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractShellStreams(
  result: Record<string, unknown> | undefined,
): { stdout?: string; stderr?: string } {
  if (!result) return {};

  const error = result.error ?? result.rejected ?? result.failure;
  if (error != null) return {};

  const success = result.success;
  if (!success || typeof success !== "object") return {};

  const s = success as Record<string, unknown>;
  const stdout =
    typeof s.stdout === "string" && s.stdout
      ? s.stdout
      : typeof s.interleavedOutput === "string"
        ? s.interleavedOutput
        : undefined;
  const stderr = typeof s.stderr === "string" && s.stderr ? s.stderr : undefined;
  return { stdout, stderr };
}

function formatToolResult(
  toolName: string,
  result: Record<string, unknown> | undefined,
): { text?: string; error?: string; stdout?: string; stderr?: string } {
  if (!result) return {};

  const error = result.error ?? result.rejected ?? result.failure;
  if (error != null) {
    return { error: truncateText(formatUnknown(error)) };
  }

  const success = result.success;
  if (!success || typeof success !== "object") {
    const raw = formatUnknown(result);
    return raw ? { text: truncateText(raw) } : {};
  }

  const s = success as Record<string, unknown>;
  switch (toolName.toLowerCase()) {
    case "shell": {
      const { stdout, stderr } = extractShellStreams(result);
      const exitCode = s.exitCode;
      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`stderr:\n${stderr}`);
      if (exitCode != null) parts.push(`exit code: ${exitCode}`);
      return {
        stdout,
        stderr,
        text: parts.length ? truncateText(parts.join("\n")) : undefined,
      };
    }
    case "read": {
      const content = typeof s.content === "string" ? s.content : "";
      const path = typeof s.path === "string" ? s.path : "";
      if (content) return { text: truncateText(content) };
      if (path) return { text: `(read ${path})` };
      break;
    }
    case "write":
    case "edit": {
      const path = typeof s.path === "string" ? s.path : "";
      const lines =
        typeof s.linesCreated === "number"
          ? `${s.linesCreated} lines`
          : typeof s.linesAdded === "number"
            ? `+${s.linesAdded}`
            : "";
      const detail = [path, lines].filter(Boolean).join(" — ");
      return detail ? { text: detail } : {};
    }
    case "grep":
    case "search": {
      const matches = s.matches ?? s.results ?? s.output;
      if (typeof matches === "string") return { text: truncateText(matches) };
      if (Array.isArray(matches)) {
        return { text: truncateText(matches.map((m) => formatUnknown(m)).join("\n")) };
      }
      break;
    }
    default:
      break;
  }

  const raw = formatUnknown(success);
  return raw ? { text: truncateText(raw) } : {};
}

function formatToolSummary(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string {
  if (!args) return toolName;

  const path = typeof args.path === "string" ? args.path : undefined;
  const command = typeof args.command === "string" ? args.command : undefined;
  const pattern =
    typeof args.pattern === "string"
      ? args.pattern
      : typeof args.query === "string"
        ? args.query
        : undefined;
  const description =
    typeof args.description === "string" ? args.description : undefined;

  if (path) return `${toolName}: ${path}`;
  if (command) {
    const short =
      command.length > 72 ? `${command.slice(0, 69)}…` : command;
    return `${toolName}: ${short}`;
  }
  if (pattern) return `${toolName}: ${pattern}`;
  if (description) return `${toolName}: ${description}`;
  return toolName;
}

function extractToolFromEvent(event: StreamEvent): ExtractedTool | null {
  if (event.type !== "tool_call") return null;

  const status = event.subtype === "completed" ? "completed" : "started";
  const tc = event.tool_call ?? {};
  const callId =
    (typeof event.call_id === "string" && event.call_id) ||
    (typeof tc.toolCallId === "string" && tc.toolCallId) ||
    undefined;
  const startedAtMs = parseToolCallMs(tc.startedAtMs);
  const completedAtMs = parseToolCallMs(tc.completedAtMs);

  for (const [key, value] of Object.entries(tc)) {
    if (!value || typeof value !== "object") continue;
    if (key === "hookAdditionalContexts") continue;

    const toolPayload = value as {
      args?: Record<string, unknown>;
      result?: Record<string, unknown>;
    };
    const name = key.replace(/ToolCall$/, "");
    const args = toolPayload.args;
    const { text: resultText, error: errorText, stdout, stderr } = formatToolResult(
      name,
      toolPayload.result,
    );

    let durationMs: number | undefined;
    if (startedAtMs != null && completedAtMs != null) {
      durationMs = Math.max(0, completedAtMs - startedAtMs);
    } else if (toolPayload.result?.success && typeof toolPayload.result.success === "object") {
      const exec = (toolPayload.result.success as { executionTime?: number })
        .executionTime;
      if (typeof exec === "number") durationMs = exec;
    }

    return {
      name,
      callId,
      status,
      args,
      resultText,
      stdout,
      stderr,
      errorText,
      durationMs,
      summary: formatToolSummary(name, args),
    };
  }

  return { name: "tool", callId, status, summary: "tool" };
}

function toolMessageFromExtracted(
  tool: ExtractedTool,
  seq: number,
  timestamp: number,
): AgentDisplayMessage {
  const isShell = tool.name.toLowerCase() === "shell";
  return {
    id: tool.callId ? `tool-${tool.callId}` : `tool-${seq}`,
    role: "tool",
    content: tool.summary,
    toolName: tool.name,
    toolStatus: tool.status,
    toolCallId: tool.callId,
    toolArgs: tool.args,
    toolResultText: tool.resultText,
    toolStdout: isShell ? (tool.stdout ?? (tool.status === "started" ? "" : undefined)) : undefined,
    toolStderr: isShell ? (tool.stderr ?? (tool.status === "started" ? "" : undefined)) : undefined,
    toolDurationMs: tool.durationMs,
    toolError: tool.errorText,
    timestamp,
  };
}

function mergeStreamChunk(existing?: string, incoming?: string): string | undefined {
  if (incoming == null || incoming === "") return existing;
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  if (existing.endsWith(incoming)) return existing;
  return existing + incoming;
}

export function mergeToolIntoExisting(
  existing: AgentDisplayMessage,
  incoming: AgentDisplayMessage,
): AgentDisplayMessage {
  const status =
    incoming.toolStatus === "completed" || existing.toolStatus === "completed"
      ? "completed"
      : "started";

  const isShell = (incoming.toolName ?? existing.toolName)?.toLowerCase() === "shell";

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    toolStatus: status,
    toolArgs: incoming.toolArgs ?? existing.toolArgs,
    toolResultText: incoming.toolResultText ?? existing.toolResultText,
    toolStdout: isShell
      ? mergeStreamChunk(existing.toolStdout, incoming.toolStdout)
      : incoming.toolStdout ?? existing.toolStdout,
    toolStderr: isShell
      ? mergeStreamChunk(existing.toolStderr, incoming.toolStderr)
      : incoming.toolStderr ?? existing.toolStderr,
    toolDurationMs: incoming.toolDurationMs ?? existing.toolDurationMs,
    toolError: incoming.toolError ?? existing.toolError,
    content: incoming.content || existing.content,
    toolName: incoming.toolName ?? existing.toolName,
    timestamp: incoming.timestamp || existing.timestamp,
  };
}

/** Pair started/completed tool_call events by call_id into single display rows. */
export function mergeToolCallMessages(
  messages: AgentDisplayMessage[],
): AgentDisplayMessage[] {
  const merged: AgentDisplayMessage[] = [];
  const indexByCallId = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role !== "tool" || !msg.toolCallId) {
      merged.push(msg);
      continue;
    }

    const existingIdx = indexByCallId.get(msg.toolCallId);
    if (existingIdx == null) {
      indexByCallId.set(msg.toolCallId, merged.length);
      merged.push(msg);
      continue;
    }

    merged[existingIdx] = mergeToolIntoExisting(merged[existingIdx]!, msg);
  }

  return merged;
}

function extractAssistantText(event: StreamEvent): string | null {
  if (event.type !== "assistant") return null;
  const content = event.message?.content?.[0]?.text;
  if (content) return content;

  if (typeof event.text === "string" && event.text) {
    return event.text;
  }

  return null;
}

/** Partial stream-json chunks include timestamp_ms; the final snapshot omits it. */
function isAssistantPartialDelta(event: StreamEvent): boolean {
  return event.type === "assistant" && event.timestamp_ms != null;
}

function mergeAssistantContent(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  return existing + incoming;
}

function sameAssistantStreamKind(a: string, b: string): boolean {
  const kind = (id: string) => (id.startsWith("thinking-") ? "thinking" : "assistant");
  return kind(a) === kind(b);
}

export function parseStreamEventLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
}

function extractShellOutputDelta(
  event: StreamEvent,
): { callId: string; stdout?: string; stderr?: string } | null {
  if (event.type !== "shell-output-delta") return null;
  const callId =
    typeof event.call_id === "string" && event.call_id ? event.call_id : null;
  if (!callId) return null;

  const stream = typeof event.stream === "string" ? event.stream.toLowerCase() : "";
  const text =
    typeof event.text === "string"
      ? event.text
      : typeof event.stdout === "string"
        ? event.stdout
        : typeof event.stderr === "string"
          ? event.stderr
          : "";

  if (!text) return null;
  if (stream === "stderr" || (event.stderr && !event.stdout)) {
    return { callId, stderr: text };
  }
  return { callId, stdout: text };
}

export function streamEventToDisplay(
  event: StreamEvent,
  seq: number,
): AgentDisplayMessage | null {
  const timestamp = event.timestamp_ms ?? Date.now();

  if (event.type === "user") {
    const text = event.message?.content?.[0]?.text;
    if (!text) return null;
    return {
      id: `user-${seq}`,
      role: "user",
      content: text,
      timestamp,
    };
  }

  if (event.type === "assistant") {
    const text = extractAssistantText(event);
    if (!text) return null;
    return {
      id: `assistant-${seq}`,
      role: "assistant",
      content: text,
      timestamp,
    };
  }

  const tool = extractToolFromEvent(event);
  if (tool) {
    return toolMessageFromExtracted(tool, seq, timestamp);
  }

  const shellDelta = extractShellOutputDelta(event);
  if (shellDelta) {
    return {
      id: `tool-${shellDelta.callId}`,
      role: "tool",
      content: "shell",
      toolName: "shell",
      toolStatus: "started",
      toolCallId: shellDelta.callId,
      toolStdout: shellDelta.stdout ?? "",
      toolStderr: shellDelta.stderr ?? "",
      timestamp,
    };
  }

  if (event.type === "result") {
    const durationSec = event.duration_ms
      ? `${Math.round(event.duration_ms / 1000)}s`
      : "done";
    return {
      id: `system-${seq}`,
      role: "system",
      content: `Agent turn completed (${durationSec})`,
      timestamp,
    };
  }

  return null;
}

export function mergeAssistantDeltas(
  messages: AgentDisplayMessage[],
): AgentDisplayMessage[] {
  const merged: AgentDisplayMessage[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant") {
      merged.push(msg);
      continue;
    }

    const last = merged[merged.length - 1];
    if (
      last?.role === "assistant" &&
      sameAssistantStreamKind(last.id, msg.id)
    ) {
      last.content = mergeAssistantContent(last.content, msg.content);
    } else {
      merged.push({ ...msg });
    }
  }

  return merged;
}

function agentMessagesEqual(
  a: AgentDisplayMessage,
  b: AgentDisplayMessage,
): boolean {
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.content === b.content &&
    a.toolStatus === b.toolStatus &&
    a.toolCallId === b.toolCallId &&
    a.toolResultText === b.toolResultText &&
    a.toolStdout === b.toolStdout &&
    a.toolStderr === b.toolStderr &&
    a.toolError === b.toolError &&
    a.toolDurationMs === b.toolDurationMs
  );
}

export function mergeIncomingMessages(
  prev: AgentDisplayMessage[],
  incoming: AgentDisplayMessage[],
): AgentDisplayMessage[] {
  if (incoming.length === 0) return prev;

  let changed = false;
  const merged = [...prev];
  for (const msg of incoming) {
    if (msg.role === "user") {
      const last = merged[merged.length - 1];
      if (last?.role === "user" && last.content === msg.content) continue;
    }

    if (msg.role === "assistant") {
      const last = merged[merged.length - 1];
      if (
        last?.role === "assistant" &&
        sameAssistantStreamKind(last.id, msg.id)
      ) {
        const content = mergeAssistantContent(last.content, msg.content);
        if (content === last.content) continue;
        merged[merged.length - 1] = {
          ...last,
          content,
        };
        changed = true;
        continue;
      }
    }

    if (msg.role === "tool" && msg.toolCallId) {
      const existingIdx = merged.findIndex(
        (m) => m.role === "tool" && m.toolCallId === msg.toolCallId,
      );
      if (existingIdx >= 0) {
        const mergedTool = mergeToolIntoExisting(merged[existingIdx]!, msg);
        if (agentMessagesEqual(mergedTool, merged[existingIdx]!)) continue;
        merged[existingIdx] = mergedTool;
        changed = true;
        continue;
      }
    }

    merged.push(msg);
    changed = true;
  }
  return changed ? merged : prev;
}

export function eventsToDisplayMessages(
  events: Array<{ seq: number; eventType: string; payload: string }>,
): AgentDisplayMessage[] {
  const raw: AgentDisplayMessage[] = [];

  for (const event of events) {
    let parsed: StreamEvent;
    try {
      parsed = JSON.parse(event.payload) as StreamEvent;
    } catch {
      continue;
    }

    if (parsed.type === "shell-output-delta") {
      const display = streamEventToDisplay(parsed, event.seq);
      if (display) raw.push(display);
      continue;
    }

    if (parsed.type === "thinking" && parsed.subtype === "delta") {
      const text = typeof parsed.text === "string" ? parsed.text : null;
      if (text) {
        raw.push({
          id: `thinking-${event.seq}`,
          role: "assistant",
          content: text,
          timestamp: parsed.timestamp_ms ?? Date.now(),
        });
      }
      continue;
    }

    if (parsed.type === "assistant" && isAssistantPartialDelta(parsed)) {
      const text = extractAssistantText(parsed);
      if (text) {
        raw.push({
          id: `assistant-${event.seq}`,
          role: "assistant",
          content: text,
          timestamp: parsed.timestamp_ms ?? Date.now(),
        });
      }
      continue;
    }

    const display = streamEventToDisplay(parsed, event.seq);
    if (display) raw.push(display);
  }

  return mergeToolCallMessages(mergeAssistantDeltas(raw));
}

function clusterHasActiveTool(tools: AgentDisplayMessage[]): boolean {
  return tools.some((t) => t.toolStatus === "started");
}

function isShellTool(msg: AgentDisplayMessage): boolean {
  return msg.role === "tool" && msg.toolName?.toLowerCase() === "shell";
}

/** Group consecutive tool messages into collapsible clusters for the UI. */
export function groupMessagesForDisplay(
  messages: AgentDisplayMessage[],
): AgentDisplayItem[] {
  const items: AgentDisplayItem[] = [];
  let toolBuffer: AgentDisplayMessage[] = [];

  const flushTools = () => {
    if (toolBuffer.length === 0) return;
    if (toolBuffer.length === 1) {
      items.push({ kind: "message", message: toolBuffer[0]! });
    } else {
      items.push({
        kind: "tool-cluster",
        id: `cluster-${toolBuffer[0]!.id}`,
        tools: [...toolBuffer],
        hasActive: clusterHasActiveTool(toolBuffer),
      });
    }
    toolBuffer = [];
  };

  for (const msg of messages) {
    if (msg.role === "tool") {
      if (isShellTool(msg)) {
        flushTools();
        items.push({ kind: "message", message: msg });
        continue;
      }
      toolBuffer.push(msg);
      continue;
    }
    flushTools();
    items.push({ kind: "message", message: msg });
  }

  flushTools();
  return items;
}

/** Short summary of tool names for cluster headers (e.g. "read, write +2"). */
export function summarizeToolCluster(tools: AgentDisplayMessage[]): string {
  const names = tools.map((t) => t.toolName ?? t.content.split(":")[0] ?? "tool");
  const unique = [...new Set(names)];
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 2).join(", ")} +${unique.length - 2}`;
}

export function formatToolDuration(durationMs?: number): string | null {
  if (durationMs == null || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatToolArgs(args?: Record<string, unknown>): string | null {
  if (!args || Object.keys(args).length === 0) return null;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function toolStatusLabel(message: AgentDisplayMessage): string {
  if (message.toolError) return "error";
  switch (message.toolStatus) {
    case "started":
      return "running";
    case "completed":
      return "completed";
    default:
      return "unknown";
  }
}
