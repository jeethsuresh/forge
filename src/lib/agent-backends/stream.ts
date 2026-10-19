import type { ParsedVendorLine } from "@/lib/agent-backends/types";

export function asStreamLine(
  event: Record<string, unknown>,
  vendorSessionId?: string,
): ParsedVendorLine {
  const eventType =
    typeof event.type === "string" && event.type.trim()
      ? event.type
      : "stream";
  return {
    eventType,
    line: JSON.stringify(event),
    vendorSessionId,
  };
}

export function parseJsonObject(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function sessionIdFromCursorEvent(
  event: Record<string, unknown>,
): string | undefined {
  if (event.type === "system" && event.subtype === "init") {
    const id = event.session_id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}
