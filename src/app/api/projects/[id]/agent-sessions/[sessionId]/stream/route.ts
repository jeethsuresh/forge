import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { eventsToDisplayMessages } from "@/lib/agent-stream";
import {
  getAgentSessionForClient,
  getAllAgentEventsAfter,
} from "@/lib/agent-runner";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const STREAM_POLL_MS = 500;
const STREAM_HEARTBEAT_EVERY = 5;

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id, sessionId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const agentSession = getAgentSessionForClient(sessionId);
  if (!agentSession || agentSession.projectId !== id) {
    return new Response("Session not found", { status: 404 });
  }

  const url = new URL(request.url);
  let afterSeq = Number(url.searchParams.get("afterSeq") ?? "0");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const onAbort = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      controller.enqueue(encoder.encode(": connected\n\n"));

      let idleTicks = 0;

      try {
        while (!request.signal.aborted) {
          const current = getAgentSessionForClient(sessionId);
          if (!current) break;

          const events = getAllAgentEventsAfter(sessionId, afterSeq);
          if (events.length > 0) {
            afterSeq = events[events.length - 1]!.seq;
            const messages = eventsToDisplayMessages(events);
            send("events", { events, messages, session: current });
            idleTicks = 0;
          } else {
            idleTicks += 1;
            if (idleTicks % STREAM_HEARTBEAT_EVERY === 0) {
              send("heartbeat", { session: current });
            }
          }

          if (TERMINAL.has(current.status)) {
            send("done", { session: current });
            break;
          }

          await new Promise((r) => setTimeout(r, STREAM_POLL_MS));
        }
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
