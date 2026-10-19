import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentEvents, agentSessions } from "@/lib/db/schema";
import { recordAgentActivity } from "@/lib/agent-heartbeat";
import { parseStreamEventLine } from "@/lib/agent-stream";
import { getBackend } from "@/lib/agent-backends/registry";
import { sessionBackendId, thinkingLevelOrNull } from "@/lib/agent-backends/session";
import type { ThinkingLevel } from "@/lib/agent-backends/types";

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
      const current = db
        .select({
          backend: agentSessions.backend,
        })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .get();
      const backendId = sessionBackendId(current ?? {});
      const vendor = getBackend(backendId).parseVendorLine(event.line);
      const line = vendor?.line ?? event.line;
      if (vendor?.eventType) eventType = vendor.eventType;
      const parsed = parseStreamEventLine(line);
      if (parsed?.type) eventType = parsed.type;
      payload = line;

      const vendorSessionId =
        vendor?.vendorSessionId?.trim() ||
        (parsed?.type === "system" &&
        parsed.subtype === "init" &&
        typeof parsed.session_id === "string"
          ? parsed.session_id.trim()
          : "");
      const thinking = thinkingLevelFromIngestText(
        typeof parsed?.text === "string" ? parsed.text : payload,
      );
      if (vendorSessionId || thinking) {
        const patch: {
          backendSessionId?: string;
          cursorSessionId?: string;
          thinkingLevel?: ThinkingLevel;
        } = {};
        if (vendorSessionId) {
          patch.backendSessionId = vendorSessionId;
          if (backendId === "cursor") patch.cursorSessionId = vendorSessionId;
        }
        if (thinking) patch.thinkingLevel = thinking;
        db.update(agentSessions)
          .set(patch)
          .where(eq(agentSessions.id, sessionId))
          .run();
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

function thinkingLevelFromIngestText(text: string): ThinkingLevel | null {
  if (/thinking=none/i.test(text)) return thinkingLevelOrNull("none");
  if (/retrying with high/i.test(text)) return thinkingLevelOrNull("high");
  return null;
}
