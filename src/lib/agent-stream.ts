export interface AgentDisplayMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  toolStatus?: "started" | "completed";
  timestamp: number;
}

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

  if (
    event.subtype === "delta" &&
    event.timestamp_ms &&
    !("model_call_id" in event)
  ) {
    return event.text ?? null;
  }

  return null;
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
      last.content += msg.content;
    } else {
      merged.push({ ...msg });
    }
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

    const display = streamEventToDisplay(parsed, event.seq);
    if (display) raw.push(display);
  }

  return mergeAssistantDeltas(raw);
}
