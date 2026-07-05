import { describe, expect, it } from "vitest";
import {
  formatDuration,
  runtimeStatusLabel,
  shortSha,
  statusColor,
} from "@/lib/utils";

describe("shortSha", () => {
  it("returns an em dash for empty input", () => {
    expect(shortSha(null)).toBe("—");
    expect(shortSha(undefined)).toBe("—");
  });

  it("truncates to seven characters", () => {
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
  });
});

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-01T00:00:15.000Z");
    expect(formatDuration(start, end)).toBe("15s");
  });

  it("formats minutes and seconds", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-01T00:02:05.000Z");
    expect(formatDuration(start, end)).toBe("2m 5s");
  });
});

describe("statusColor", () => {
  it("maps known deployment statuses", () => {
    expect(statusColor("success")).toContain("emerald");
    expect(statusColor("failed")).toContain("red");
    expect(statusColor("building")).toContain("amber");
  });
});

describe("runtimeStatusLabel", () => {
  it("maps runtime statuses to labels", () => {
    expect(runtimeStatusLabel("running")).toBe("Running");
    expect(runtimeStatusLabel("stopped")).toBe("Stopped");
    expect(runtimeStatusLabel("partial")).toBe("Partially running");
  });
});
