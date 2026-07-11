import { describe, expect, it } from "vitest";
import type { CaddyLogEntry } from "@/lib/caddy-logs";
import { entryMatchesLogHosts } from "@/components/ProjectCaddyLogsPanel";

function entry(host: string | null): CaddyLogEntry {
  return {
    raw: "{}",
    parsed: host
      ? {
          timestamp: null,
          level: null,
          message: "handled request",
          method: "GET",
          uri: "/",
          host,
          remoteAddr: null,
          status: 200,
          durationMs: 1,
          size: 0,
          logger: null,
        }
      : null,
    formatted: host ?? "—",
  };
}

describe("entryMatchesLogHosts", () => {
  it("matches exact and subdomain hosts", () => {
    expect(entryMatchesLogHosts(entry("app.example.com"), ["app.example.com"])).toBe(
      true,
    );
    expect(
      entryMatchesLogHosts(entry("api.app.example.com"), ["app.example.com"]),
    ).toBe(true);
    expect(entryMatchesLogHosts(entry("other.example.com"), ["app.example.com"])).toBe(
      false,
    );
  });

  it("returns all entries when no hosts filter is set", () => {
    expect(entryMatchesLogHosts(entry("any.host"), [])).toBe(true);
  });
});
