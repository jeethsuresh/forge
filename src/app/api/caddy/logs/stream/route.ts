import { getSession } from "@/lib/auth/session";
import { getCaddyLogBuffer } from "@/lib/caddy-log-buffer";

const PUSH_WAIT_MS = 15_000;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  let afterSeq = Number(url.searchParams.get("afterSeq") ?? "0");
  if (!Number.isFinite(afterSeq) || afterSeq < 0) {
    afterSeq = 0;
  }

  const buffer = getCaddyLogBuffer();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      controller.enqueue(encoder.encode(": connected\n\n"));

      while (true) {
        if (request.signal.aborted) break;

        const batch = buffer.getAfter(afterSeq);
        if (batch.entries.length > 0) {
          afterSeq = batch.tailSeq;
          send("entries", {
            entries: batch.entries,
            tailSeq: afterSeq,
          });
        } else {
          send("heartbeat", { tailSeq: afterSeq });
          await buffer.waitForEntriesAfter(afterSeq, PUSH_WAIT_MS);
        }
      }

      controller.close();
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
