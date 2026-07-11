import net from "net";
import { getCaddyLogBuffer } from "@/lib/caddy-log-buffer";
import { getCaddyLogTcpPort } from "@/lib/caddy-log-env";

declare global {
  var __forgeCaddyLogTcpStarted: boolean | undefined;
}

const MAX_PARTIAL_BYTES = 64 * 1024;
const MAX_TCP_CONNECTIONS = 8;

function parseTcpChunk(partial: string, chunk: Buffer): {
  partial: string;
  values: unknown[];
} {
  const text = partial + chunk.toString("utf8");
  const parts = text.split("\n");
  const nextPartial = text.endsWith("\n") ? "" : (parts.pop() ?? "");
  const values: unknown[] = [];

  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as unknown);
    } catch {
      values.push(trimmed);
    }
  }

  return { partial: nextPartial, values };
}

export function startCaddyLogTcpIngest(): void {
  if (globalThis.__forgeCaddyLogTcpStarted) return;
  globalThis.__forgeCaddyLogTcpStarted = true;

  const port = getCaddyLogTcpPort();
  let activeConnections = 0;

  const server = net.createServer((socket) => {
    if (activeConnections >= MAX_TCP_CONNECTIONS) {
      socket.destroy();
      return;
    }

    activeConnections += 1;
    let partial = "";

    const cleanup = () => {
      activeConnections = Math.max(0, activeConnections - 1);
    };

    socket.on("data", (chunk) => {
      if (partial.length + chunk.length > MAX_PARTIAL_BYTES) {
        partial = "";
        socket.destroy();
        return;
      }

      const parsed = parseTcpChunk(partial, chunk);
      partial = parsed.partial;
      if (parsed.values.length > 0) {
        getCaddyLogBuffer().ingest(parsed.values);
      }
    });

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });

  server.on("error", (err) => {
    console.error("[forge] Caddy log TCP ingest failed:", err);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[forge] Caddy log TCP ingest listening on 127.0.0.1:${port}`);
  });
}
