import net from "net";
import { getCaddyLogBuffer } from "@/lib/caddy-log-buffer";
import { getCaddyLogTcpPort } from "@/lib/caddy-log-env";

declare global {
  var __forgeCaddyLogTcpStarted: boolean | undefined;
}

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
  const server = net.createServer((socket) => {
    let partial = "";
    socket.on("data", (chunk) => {
      const parsed = parseTcpChunk(partial, chunk);
      partial = parsed.partial;
      if (parsed.values.length > 0) {
        getCaddyLogBuffer().ingest(parsed.values);
      }
    });
  });

  server.on("error", (err) => {
    console.error("[forge] Caddy log TCP ingest failed:", err);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[forge] Caddy log TCP ingest listening on 127.0.0.1:${port}`);
  });
}
