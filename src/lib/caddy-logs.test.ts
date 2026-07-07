import { describe, expect, it } from "vitest";
import {
  formatCaddyLogEntry,
  parseCaddyLogLine,
  parseCaddyLogObject,
  parseIngestBody,
  toCaddyLogEntry,
  toCaddyLogEntryFromValue,
} from "@/lib/caddy-logs";

const accessLog = {
  level: "info",
  ts: 1710000000.123,
  logger: "http.log.access.log0",
  msg: "handled request",
  request: {
    remote_ip: "203.0.113.10",
    remote_port: "54321",
    client_ip: "203.0.113.10",
    proto: "HTTP/2.0",
    method: "GET",
    host: "forge.example.com",
    uri: "/api/projects",
    headers: {},
  },
  duration: 0.0042,
  size: 512,
  status: 200,
};

describe("parseCaddyLogLine", () => {
  it("parses JSON access log lines", () => {
    const parsed = parseCaddyLogLine(JSON.stringify(accessLog));
    expect(parsed).toMatchObject({
      level: "info",
      message: "handled request",
      method: "GET",
      uri: "/api/projects",
      host: "forge.example.com",
      remoteAddr: "203.0.113.10:54321",
      status: 200,
      durationMs: 4.2,
      size: 512,
      logger: "http.log.access.log0",
    });
    expect(parsed?.timestamp).toBe(new Date(1710000000.123 * 1000).toISOString());
  });

  it("returns null for non-JSON lines", () => {
    expect(parseCaddyLogLine("GET / HTTP/1.1 200")).toBeNull();
    expect(parseCaddyLogLine("")).toBeNull();
  });
});

describe("formatCaddyLogEntry", () => {
  it("formats access logs into a readable line", () => {
    const parsed = parseCaddyLogObject(accessLog);
    const formatted = formatCaddyLogEntry(parsed);
    expect(formatted).toContain("GET forge.example.com/api/projects");
    expect(formatted).toContain("200");
    expect(formatted).toContain("4.2ms");
    expect(formatted).toContain("512B");
    expect(formatted).toContain("203.0.113.10:54321");
  });

  it("includes generic messages for non-access logs", () => {
    const formatted = formatCaddyLogEntry(
      parseCaddyLogObject({
        level: "warn",
        ts: 1710000001,
        msg: "admin endpoint disabled",
      }),
    );
    expect(formatted).toContain("WARN");
    expect(formatted).toContain("admin endpoint disabled");
  });
});

describe("toCaddyLogEntry", () => {
  it("falls back to raw text when parsing fails", () => {
    const entry = toCaddyLogEntry("plain text line");
    expect(entry.parsed).toBeNull();
    expect(entry.formatted).toBe("plain text line");
  });
});

describe("toCaddyLogEntryFromValue", () => {
  it("parses structured JSON objects directly", () => {
    const entry = toCaddyLogEntryFromValue({
      level: "info",
      msg: "handled request",
      status: 201,
      request: { method: "POST", host: "forge.local", uri: "/api" },
    });
    expect(entry.parsed).toMatchObject({
      method: "POST",
      host: "forge.local",
      status: 201,
    });
    expect(entry.formatted).toContain("POST forge.local/api");
  });
});

describe("parseIngestBody", () => {
  it("accepts single objects, entry wrappers, and batches", () => {
    const object = { msg: "one" };
    expect(parseIngestBody(object)).toEqual([object]);
    expect(parseIngestBody({ entry: object })).toEqual([object]);
    expect(parseIngestBody({ entries: [object, { msg: "two" }] })).toHaveLength(
      2,
    );
  });
});
