import { eventsToDisplayMessages } from "@/lib/agent-stream";
import { parseStoredUserEventPrompt } from "@/lib/agent-turn";

export const AGENT_RESTART_PROMPT_MAX_CHARS = 24_000;

const HEADER = `You are replacing a previous agent on this branch that was stuck or needed a fresh start.
The workspace files are unchanged. Do not redo completed file edits unless they are wrong.
The latest turn may be incomplete. Continue that work.

`;

type EventRow = { seq: number; eventType: string; payload: string };

function assistantTextFromPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      type?: string;
      text?: string;
      message?: { content?: Array<{ type?: string; text?: string }> };
    };
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      return parsed.text.trim();
    }
    const parts = parsed.message?.content;
    if (Array.isArray(parts)) {
      const joined = parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("")
        .trim();
      if (joined) return joined;
    }
  } catch {
    // ignore
  }
  return null;
}

function systemLine(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      subtype?: string;
      text?: string;
      exitCode?: number;
      type?: string;
    };
    if (parsed.subtype === "agent-exit") {
      return `agent-exit code ${parsed.exitCode ?? "?"}`;
    }
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      return parsed.text.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

export function buildAgentRestartPrompt(input: {
  initialPrompt: string;
  events: EventRow[];
  maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? AGENT_RESTART_PROMPT_MAX_CHARS;
  const blocks: string[] = [];
  const original = input.initialPrompt.trim();
  if (original) {
    blocks.push(`## Original instruction\n${original}`);
  }

  const transcript: string[] = [];
  const displayed = eventsToDisplayMessages(input.events);
  if (displayed.length > 0) {
    for (const msg of displayed) {
      if (msg.role === "tool") {
        const name = msg.toolName?.trim() || "tool";
        const summary = msg.content.replace(/\s+/g, " ").trim().slice(0, 200);
        transcript.push(`- tool ${name}: ${summary}`);
        continue;
      }
      const label =
        msg.role === "user"
          ? "User"
          : msg.role === "system"
            ? "System"
            : "Assistant";
      const body = msg.content.trim();
      if (!body) continue;
      transcript.push(`### ${label}\n${body}`);
    }
  } else {
    for (const event of input.events) {
      if (event.eventType === "user") {
        const text = parseStoredUserEventPrompt(event.payload);
        if (text) transcript.push(`### User\n${text}`);
        continue;
      }
      if (event.eventType === "assistant") {
        const text = assistantTextFromPayload(event.payload);
        if (text) transcript.push(`### Assistant\n${text}`);
        continue;
      }
      if (event.eventType === "system") {
        const text = systemLine(event.payload);
        if (text) transcript.push(`### System\n${text}`);
      }
    }
  }

  if (transcript.length > 0) {
    blocks.push(`## Transcript\n${transcript.join("\n\n")}`);
  }

  const body = `${HEADER}${blocks.join("\n\n")}\n`;
  if (body.length <= maxChars) return body;
  const keepHeader = HEADER;
  const budget = maxChars - keepHeader.length - 20;
  const tail = body.slice(keepHeader.length).slice(-Math.max(budget, 0));
  return `${keepHeader}…(truncated)\n${tail}`.slice(0, maxChars);
}
