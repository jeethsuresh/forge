export interface ParsedCaddyLog {
  timestamp: string | null;
  level: string | null;
  message: string;
  method: string | null;
  uri: string | null;
  host: string | null;
  remoteAddr: string | null;
  status: number | null;
  durationMs: number | null;
  size: number | null;
  logger: string | null;
}

export interface CaddyLogEntry {
  raw: string;
  parsed: ParsedCaddyLog | null;
  formatted: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatTimestamp(ts: unknown): string | null {
  if (typeof ts === "number") {
    return new Date(ts * 1000).toISOString();
  }
  if (typeof ts === "string") {
    return ts;
  }
  return null;
}

function formatRemoteAddr(request: Record<string, unknown> | null): string | null {
  if (!request) return null;
  const remoteIp = request.remote_ip ?? request.client_ip;
  if (typeof remoteIp !== "string") return null;
  const remotePort = request.remote_port;
  if (typeof remotePort === "string" || typeof remotePort === "number") {
    return `${remoteIp}:${remotePort}`;
  }
  return remoteIp;
}

export function parseCaddyLogObject(
  obj: Record<string, unknown>,
): ParsedCaddyLog {
  const request = isRecord(obj.request) ? obj.request : null;
  const duration = obj.duration;

  return {
    timestamp: formatTimestamp(obj.ts),
    level: typeof obj.level === "string" ? obj.level : null,
    message: typeof obj.msg === "string" ? obj.msg : "—",
    method: typeof request?.method === "string" ? request.method : null,
    uri: typeof request?.uri === "string" ? request.uri : null,
    host: typeof request?.host === "string" ? request.host : null,
    remoteAddr: formatRemoteAddr(request),
    status: typeof obj.status === "number" ? obj.status : null,
    durationMs: typeof duration === "number" ? duration * 1000 : null,
    size: typeof obj.size === "number" ? obj.size : null,
    logger: typeof obj.logger === "string" ? obj.logger : null,
  };
}

export function parseCaddyLogLine(line: string): ParsedCaddyLog | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!isRecord(value)) return null;
    return parseCaddyLogObject(value);
  } catch {
    return null;
  }
}

export function formatCaddyLogEntry(parsed: ParsedCaddyLog): string {
  const parts: string[] = [];

  if (parsed.timestamp) {
    parts.push(
      parsed.timestamp.replace("T", " ").replace(/\.\d{3}Z$/, "Z"),
    );
  }
  if (parsed.level) {
    parts.push(parsed.level.toUpperCase());
  }

  if (parsed.method) {
    const target = `${parsed.host ?? ""}${parsed.uri ?? ""}` || "—";
    parts.push(`${parsed.method} ${target}`);
  }

  if (parsed.status !== null) {
    parts.push(String(parsed.status));
  }
  if (parsed.durationMs !== null) {
    parts.push(
      parsed.durationMs < 10
        ? `${parsed.durationMs.toFixed(1)}ms`
        : `${Math.round(parsed.durationMs)}ms`,
    );
  }
  if (parsed.size !== null) {
    parts.push(`${parsed.size}B`);
  }
  if (parsed.remoteAddr) {
    parts.push(parsed.remoteAddr);
  }

  if (parts.length === 0) {
    return parsed.message;
  }

  const line = parts.join("  ");
  if (
    parsed.message &&
    parsed.message !== "handled request" &&
    parsed.message !== "—"
  ) {
    return `${line}  ${parsed.message}`;
  }
  return line;
}

export function toCaddyLogEntry(line: string): CaddyLogEntry {
  const parsed = parseCaddyLogLine(line);
  return {
    raw: line,
    parsed,
    formatted: parsed ? formatCaddyLogEntry(parsed) : line,
  };
}

export function toCaddyLogEntryFromValue(value: unknown): CaddyLogEntry {
  if (typeof value === "string") {
    return toCaddyLogEntry(value);
  }

  if (isRecord(value)) {
    const parsed = parseCaddyLogObject(value);
    const raw = JSON.stringify(value);
    return {
      raw,
      parsed,
      formatted: formatCaddyLogEntry(parsed),
    };
  }

  const raw = String(value);
  return {
    raw,
    parsed: null,
    formatted: raw,
  };
}

export function parseIngestBody(body: unknown): unknown[] {
  if (body === null || body === undefined) {
    return [];
  }

  if (Array.isArray(body)) {
    return body;
  }

  if (!isRecord(body)) {
    return [body];
  }

  const entries = body.entries;
  if (Array.isArray(entries)) {
    return entries;
  }

  const entry = body.entry;
  if (entry !== undefined) {
    return [entry];
  }

  return [body];
}

export function parseNdjsonBody(text: string): unknown[] {
  const values: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as unknown);
    } catch {
      values.push(trimmed);
    }
  }
  return values;
}
