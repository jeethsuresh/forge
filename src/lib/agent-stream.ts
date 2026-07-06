export interface AgentDisplayMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  toolStatus?: "started" | "completed";
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
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  text?: string;
  tool_call?: Record<string, unknown>;
  duration_ms?: number;
  timestamp_ms?: number;
}

function extractToolInfo(event: StreamEvent): {
  name: string;
  path?: string;
  status: "started" | "completed";
} | null {
  if (event.type !== "tool_call") return null;

  const status = event.subtype === "completed" ? "completed" : "started";
  const tc = event.tool_call ?? {};

  for (const [key, value] of Object.entries(tc)) {
    if (!value || typeof value !== "object") continue;
    const args = (value as { args?: { path?: string } }).args;
    const name = key.replace(/ToolCall$/, "");
    return { name, path: args?.path, status };
  }

  return { name: "tool", status };
}

function extractAssistantText(event: StreamEvent): string | null {
  if (event.type !== "assistant") return null;
  const content = event.message?.content?.[0]?.text;
  if (content) return content;

  if (event.subtype === "delta" && event.text) {
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

export function parseStreamEventLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
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

  const tool = extractToolInfo(event);
  if (tool) {
    const pathSuffix = tool.path ? `: ${tool.path}` : "";
    return {
      id: `tool-${seq}`,
      role: "tool",
      content: `${tool.name}${pathSuffix}`,
      toolName: tool.name,
      toolStatus: tool.status,
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
    if (last?.role === "assistant" && last.id.startsWith("assistant-")) {
      last.content = mergeAssistantContent(last.content, msg.content);
    } else {
      merged.push({ ...msg });
    }
  }

  return merged;
}

export function mergeIncomingMessages(
  prev: AgentDisplayMessage[],
  incoming: AgentDisplayMessage[],
): AgentDisplayMessage[] {
  const merged = [...prev];
  for (const msg of incoming) {
    if (msg.role === "user") {
      const last = merged[merged.length - 1];
      if (last?.role === "user" && last.content === msg.content) continue;
    }

    if (msg.role === "assistant") {
      const last = merged[merged.length - 1];
      if (last?.role === "assistant") {
        merged[merged.length - 1] = {
          ...last,
          content: mergeAssistantContent(last.content, msg.content),
        };
        continue;
      }
    }

    merged.push(msg);
  }
  return merged;
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

  return mergeAssistantDeltas(raw);
}

function clusterHasActiveTool(tools: AgentDisplayMessage[]): boolean {
  return tools.some((t) => t.toolStatus === "started");
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
