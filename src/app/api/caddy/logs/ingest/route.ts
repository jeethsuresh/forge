import { NextResponse } from "next/server";
import { getCaddyLogBuffer } from "@/lib/caddy-log-buffer";
import {
  isCaddyLogIngestConfigured,
  verifyCaddyLogIngestToken,
} from "@/lib/caddy-log-env";
import { parseIngestBody, parseNdjsonBody } from "@/lib/caddy-logs";

const MAX_INGEST_BODY_BYTES = 256 * 1024;
const MAX_INGEST_ENTRIES = 100;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isCaddyLogIngestConfigured()) {
    return NextResponse.json(
      { error: "Caddy log ingest is not configured" },
      { status: 503 },
    );
  }

  if (!verifyCaddyLogIngestToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_INGEST_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let values: unknown[] = [];

  try {
    if (contentType.includes("application/x-ndjson")) {
      const text = await request.text();
      if (text.length > MAX_INGEST_BODY_BYTES) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      values = parseNdjsonBody(text);
    } else {
      const text = await request.text();
      if (text.length > MAX_INGEST_BODY_BYTES) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      const body = text ? (JSON.parse(text) as unknown) : null;
      values = parseIngestBody(body);
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (values.length === 0) {
    return NextResponse.json({ error: "No log entries provided" }, { status: 400 });
  }

  if (values.length > MAX_INGEST_ENTRIES) {
    return NextResponse.json(
      { error: `Too many log entries (max ${MAX_INGEST_ENTRIES})` },
      { status: 413 },
    );
  }

  const ingested = getCaddyLogBuffer().ingest(values);
  return NextResponse.json({
    ok: true,
    accepted: ingested.length,
    tailSeq: getCaddyLogBuffer().getTailSeq(),
  });
}
