import { describe, expect, it } from "vitest";
import { isSessionExemptPath } from "@/lib/http-public-path";

describe("isSessionExemptPath", () => {
  it("exempts health, ops, git, ingest, recover, and login", () => {
    expect(isSessionExemptPath("/login")).toBe(true);
    expect(isSessionExemptPath("/api/auth/login")).toBe(true);
    expect(isSessionExemptPath("/api/forge/health")).toBe(true);
    expect(isSessionExemptPath("/api/ops")).toBe(true);
    expect(isSessionExemptPath("/api/ops/projects/x/deploy")).toBe(true);
    expect(isSessionExemptPath("/api/git/demo.git/info/refs")).toBe(true);
    expect(isSessionExemptPath("/api/caddy/logs/ingest")).toBe(true);
    expect(isSessionExemptPath("/api/forge/recover")).toBe(true);
  });

  it("requires a session for Caddy log read and dashboard APIs", () => {
    expect(isSessionExemptPath("/api/caddy/logs")).toBe(false);
    expect(isSessionExemptPath("/api/projects")).toBe(false);
    expect(isSessionExemptPath("/")).toBe(false);
    expect(isSessionExemptPath("/projects/abc")).toBe(false);
  });
});
