import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentEvents } from "@/lib/db/schema";
import { recordAgentActivity } from "@/lib/agent-heartbeat";
import { parseStreamEventLine } from "@/lib/agent-stream";

function nextEventSeq(sessionId: string): number {
  const row = db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
    .get();
  return (row?.seq ?? 0) + 1;
}

export type IngestAgentEventInput = {
  type?: string;
  eventType?: string;
  payload?: string | Record<string, unknown>;
  line?: string;
};

/**
 * Append agent-posted events to agent_events (UI must not depend on docker logs).
 * Returns the number of events recorded.
 */
export function ingestAgentEvents(
  sessionId: string,
  events: IngestAgentEventInput[],
): number {
  let count = 0;
  for (const event of events) {
    let eventType = event.eventType ?? event.type ?? "stream";
    let payload: string;

    if (typeof event.line === "string" && event.line.trim()) {
      const parsed = parseStreamEventLine(event.line);
      if (parsed?.type) eventType = parsed.type;
      payload = event.line;
      if (parsed?.type === "system" && parsed.subtype === "init" && parsed.session_id) {
        // cursor session id is updated by agent-runner when process-mode streams;
        // container mode may post init via events — leave to caller if needed.
      }
    } else if (typeof event.payload === "string") {
      payload = event.payload;
    } else if (event.payload && typeof event.payload === "object") {
      payload = JSON.stringify(event.payload);
    } else {
      payload = JSON.stringify(event);
    }

    const seq = nextEventSeq(sessionId);
    db.insert(agentEvents)
      .values({
        id: randomUUID(),
        sessionId,
        seq,
        eventType,
        payload,
        createdAt: new Date(),
      })
      .run();
    count += 1;
  }

  if (count > 0) {
    recordAgentActivity(sessionId);
  }
  return count;
}
