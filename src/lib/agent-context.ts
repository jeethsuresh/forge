import { eventsToDisplayMessages } from "@/lib/agent-stream";

export const AGENT_TOOL_RESULT_MAX_CHARS = 8_000;
export const AGENT_CONTEXT_COMPACT_MAX_CHARS = 16_000;

export type AgentContextEvent = {
  seq: number;
  eventType: string;
  payload: string;
};

type CompactPhase = "request" | "stored";

function compactPhase(event: AgentContextEvent): CompactPhase | null {
  try {
    const parsed = JSON.parse(event.payload) as {
      type?: string;
      subtype?: string;
      phase?: string;
    };
    if (parsed.type !== "system" || parsed.subtype !== "context-compact") {
      return null;
    }
    if (parsed.phase === "request" || parsed.phase === "stored") return parsed.phase;
  } catch {
    return null;
  }
  return null;
}

export function eventsOutsideContextCompaction(
  events: AgentContextEvent[],
): AgentContextEvent[] {
  const outside: AgentContextEvent[] = [];
  let skipping = false;
  for (const event of events) {
    const phase = compactPhase(event);
    if (phase === "request") {
      skipping = true;
      continue;
    }
    if (phase === "stored") {
      skipping = false;
      continue;
    }
    if (skipping) continue;
    outside.push(event);
  }
  return outside;
}

function lastStoredSeq(events: AgentContextEvent[]): number | null {
  let seq: number | null = null;
  for (const event of events) {
    if (compactPhase(event) === "stored") seq = event.seq;
  }
  return seq;
}

function latestTurn(events: AgentContextEvent[]): AgentContextEvent[] {
  let start = 0;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]?.eventType === "user") start = i;
  }
  if (!events.some((event) => event.eventType === "user")) return events;
  return events.slice(start);
}

/** Turns the next prompt should include given the stored compact. */
export function eventsForFollowUp(
  events: AgentContextEvent[],
  compact: string | null,
): AgentContextEvent[] {
  const outside = eventsOutsideContextCompaction(events);
  if (!compact?.trim()) return outside;
  const storedSeq = lastStoredSeq(events);
  const afterStored = outside.filter(
    (event) => storedSeq == null || event.seq > storedSeq,
  );
  const hasUncompactedWork = afterStored.some(
    (event) =>
      event.eventType === "user" ||
      event.eventType === "assistant" ||
      event.eventType === "tool_call",
  );
  if (hasUncompactedWork) return afterStored;
  return latestTurn(outside);
}

export function eventsToCompact(events: AgentContextEvent[]): AgentContextEvent[] {
  const outside = eventsOutsideContextCompaction(events);
  const storedSeq = lastStoredSeq(events);
  const afterStored = outside.filter(
    (event) => storedSeq == null || event.seq > storedSeq,
  );
  const hasWork = afterStored.some(
    (event) =>
      event.eventType === "user" ||
      event.eventType === "assistant" ||
      event.eventType === "tool_call",
  );
  if (hasWork) return afterStored;
  return latestTurn(outside);
}

export function shouldRequestCompaction(events: AgentContextEvent[]): boolean {
  return eventsToCompact(events).some(
    (event) => event.eventType === "assistant" || event.eventType === "tool_call",
  );
}

function formatTurnForPrompt(events: AgentContextEvent[]): string {
  const messages = eventsToDisplayMessages(events);
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const name = message.toolName?.trim() || "tool";
      const body = (message.toolResultText || message.content || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, AGENT_TOOL_RESULT_MAX_CHARS);
      lines.push(`- tool ${name}: ${body}`);
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    const body = message.content.trim();
    if (!body) continue;
    const label = message.role === "user" ? "User" : "Assistant";
    lines.push(`### ${label}\n${body}`);
  }
  return lines.join("\n\n");
}

export function composeUserTurnPrompt(input: {
  compact: string | null | undefined;
  events: AgentContextEvent[];
  newMessage: string;
}): string {
  const compact = input.compact?.trim() ?? "";
  const included = eventsForFollowUp(input.events, compact || null);
  const history = formatTurnForPrompt(included);
  if (!history) return input.newMessage.trim();

  return [`## Latest turn\n${history}`, `## New message\n${input.newMessage.trim()}`].join(
    "\n\n",
  );
}

/** System prompt, then learnings. The system prompt is not part of the user turn. */
export function assembleAgentPrompt(input: {
  systemPrompt: string;
  compact: string | null | undefined;
  userTurn: string;
}): string {
  const sections = [input.systemPrompt.trim()];
  const compact = input.compact?.trim();
  if (compact) sections.push(`## Compacted learnings\n${compact}`);
  sections.push(input.userTurn.trim());
  return sections.join("\n\n");
}

export function buildContextCompactionPrompt(input: {
  previousCompact: string | null | undefined;
  events: AgentContextEvent[];
}): string {
  const previous = input.previousCompact?.trim() || "(none)";
  const turn = formatTurnForPrompt(eventsToCompact(input.events)) || "(no turn text)";
  return `Rewrite the compacted learnings for this Forge agent session so they are a standalone memory.
Reply with only the compacted learnings markdown. Do not include Ops API instructions.
Keep decisions, files and behavior that changed, constraints, errors and fixes, and unfinished work.
Previous learnings that are still true stay. Remove superseded guesses.

## Previous learnings
${previous}

## Turn to fold in
${turn}`;
}

export function clampContextCompact(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= AGENT_CONTEXT_COMPACT_MAX_CHARS) return trimmed;
  return trimmed.slice(0, AGENT_CONTEXT_COMPACT_MAX_CHARS);
}

/** Heuristic: last line ends with `?`, or recent text has ≥2 A)–D) options. */
export function looksLikeAgentQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (last.endsWith("?")) return true;
  const recent = lines.slice(-12).join("\n");
  const options = recent.match(/^\s*(?:\*\*)?[A-D](?:\*\*)?[.):]\s+\S/gm);
  return Boolean(options && options.length >= 2);
}

function assistantTextFromPayload(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as {
      text?: unknown;
      message?: { content?: Array<{ text?: unknown }> };
    };
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      return parsed.text.trim();
    }
    const parts = parsed.message?.content;
    if (!Array.isArray(parts)) return null;
    const joined = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    return joined || null;
  } catch {
    return null;
  }
}

/** Last non-empty assistant event text outside compaction markers. */
export function lastAssistantText(events: AgentContextEvent[]): string | null {
  const outside = eventsOutsideContextCompaction(events);
  for (let i = outside.length - 1; i >= 0; i -= 1) {
    const event = outside[i]!;
    if (event.eventType !== "assistant") continue;
    const text = assistantTextFromPayload(event.payload);
    if (text) return text;
  }
  return null;
}

/** True when the latest user turn's last assistant message looks like a question. */
export function turnEndedWithQuestion(events: AgentContextEvent[]): boolean {
  const outside = eventsOutsideContextCompaction(events);
  let lastUserSeq = 0;
  for (const event of outside) {
    if (event.eventType === "user") lastUserSeq = event.seq;
  }
  const slice =
    lastUserSeq > 0
      ? outside.filter((event) => event.seq > lastUserSeq)
      : outside;
  const text = lastAssistantText(slice);
  return text != null && looksLikeAgentQuestion(text);
}

export function extractCompactionReply(events: AgentContextEvent[]): string | null {
  let start = -1;
  for (let i = 0; i < events.length; i += 1) {
    if (compactPhase(events[i]!) === "request") start = i;
  }
  if (start < 0) return null;
  const slice: AgentContextEvent[] = [];
  for (const event of events.slice(start + 1)) {
    if (compactPhase(event) === "stored") break;
    slice.push(event);
  }
  const messages = eventsToDisplayMessages(slice);
  let reply = "";
  for (const message of messages) {
    if (message.role === "assistant" && message.content.trim()) {
      reply = message.content.trim();
    }
  }
  if (!reply) return null;
  return clampContextCompact(reply);
}
