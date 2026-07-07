import { NextResponse } from "next/server";
import { getCaddyLogBuffer } from "@/lib/caddy-log-buffer";
import {
  isCaddyLogIngestConfigured,
  verifyCaddyLogIngestToken,
} from "@/lib/caddy-log-env";
import { parseIngestBody, parseNdjsonBody } from "@/lib/caddy-logs";

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

  const contentType = request.headers.get("content-type") ?? "";
  let values: unknown[] = [];

  try {
    if (contentType.includes("application/x-ndjson")) {
      values = parseNdjsonBody(await request.text());
    } else {
      const body = (await request.json().catch(() => null)) as unknown;
      values = parseIngestBody(body);
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (values.length === 0) {
    return NextResponse.json({ error: "No log entries provided" }, { status: 400 });
  }

  const ingested = getCaddyLogBuffer().ingest(values);
  return NextResponse.json({
    ok: true,
    accepted: ingested.length,
    tailSeq: getCaddyLogBuffer().getTailSeq(),
  });
}
