import { NextResponse } from "next/server";
import { getCaddyLogBuffer } from "@/lib/caddy-log-buffer";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tail = Math.min(
    Math.max(Number(url.searchParams.get("tail") ?? "200"), 1),
    1000,
  );

  const buffer = getCaddyLogBuffer();
  const entries = buffer.getTail(tail);
  return NextResponse.json({
    configured: true,
    source: "push",
    ingestPath: "/api/caddy/logs/ingest",
    tailSeq: buffer.getTailSeq(),
    entries,
  });
}
