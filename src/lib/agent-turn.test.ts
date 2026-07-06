import { describe, expect, it } from "vitest";
import {
  failedTurnEventSeq,
  filterEventsBeforeSeq,
  findFailedTurnPrompt,
  isSessionTurnFailed,
  isStuckActiveSession,
  isTerminalSessionStatus,
  parseStoredUserEventPrompt,
  reconcileAgentBusy,
  resolveAgentSessionBanner,
} from "@/lib/agent-turn";

const EVENTS = [
  {
    seq: 1,
    eventType: "user",
    payload: JSON.stringify({ type: "user", text: "First task" }),
  },
  {
    seq: 2,
    eventType: "assistant",
    payload: JSON.stringify({ type: "assistant", text: "Done" }),
  },
  {
    seq: 3,
    eventType: "user",
    payload: JSON.stringify({ type: "user", text: "Second task" }),
  },
  {
    seq: 4,
    eventType: "tool_call",
    payload: JSON.stringify({ type: "tool_call" }),
  },
];

describe("parseStoredUserEventPrompt", () => {
  it("extracts prompt text from stored user events", () => {
    expect(
      parseStoredUserEventPrompt(
        JSON.stringify({ type: "user", text: "  Fix the bug  " }),
      ),
    ).toBe("Fix the bug");
  });

  it("returns null for invalid payloads", () => {
    expect(parseStoredUserEventPrompt("not json")).toBeNull();
    expect(parseStoredUserEventPrompt(JSON.stringify({ type: "assistant" }))).toBeNull();
  });
});

describe("findFailedTurnPrompt", () => {
  it("uses failedTurnStartSeq when set", () => {
    expect(findFailedTurnPrompt(EVENTS, 3)).toBe("Second task");
    expect(findFailedTurnPrompt(EVENTS, 1)).toBe("First task");
  });

  it("falls back to the last user event", () => {
    expect(findFailedTurnPrompt(EVENTS, null)).toBe("Second task");
  });
});

describe("failedTurnEventSeq", () => {
  it("returns the configured failed turn boundary", () => {
    expect(failedTurnEventSeq(EVENTS, 3)).toBe(3);
  });

  it("falls back to the last user event seq", () => {
    expect(failedTurnEventSeq(EVENTS, null)).toBe(3);
  });
});

describe("filterEventsBeforeSeq", () => {
  it("keeps events before the failed turn", () => {
    expect(filterEventsBeforeSeq(EVENTS, 3).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("returns all events when no boundary is set", () => {
    expect(filterEventsBeforeSeq(EVENTS, null)).toHaveLength(EVENTS.length);
  });
});

describe("isSessionTurnFailed", () => {
  it("is true for failed sessions", () => {
    expect(isSessionTurnFailed("failed")).toBe(true);
    expect(isSessionTurnFailed("running")).toBe(false);
  });
});

describe("isTerminalSessionStatus", () => {
  it("recognizes terminal session statuses", () => {
    expect(isTerminalSessionStatus("failed")).toBe(true);
    expect(isTerminalSessionStatus("completed")).toBe(true);
    expect(isTerminalSessionStatus("running")).toBe(false);
  });
});

describe("reconcileAgentBusy", () => {
  it("clears busy when the session is terminal", () => {
    expect(reconcileAgentBusy(true, "failed")).toBe(false);
    expect(reconcileAgentBusy(true, "completed")).toBe(false);
    expect(reconcileAgentBusy(true, "running")).toBe(true);
    expect(reconcileAgentBusy(false, "running")).toBe(false);
  });
});

describe("resolveAgentSessionBanner", () => {
  it("shows failure even when agentBusy is stale", () => {
    expect(
      resolveAgentSessionBanner({
        status: "failed",
        agentBusy: true,
        isDeploying: false,
        errorMessage: "Agent exited with code 1",
        failedTurnStartSeq: 3,
      }),
    ).toEqual({
      kind: "failed",
      text: "Agent exited with code 1",
      canRetry: true,
    });
  });

  it("shows working while a turn is in progress", () => {
    expect(
      resolveAgentSessionBanner({
        status: "running",
        agentBusy: true,
        isDeploying: false,
        errorMessage: null,
        failedTurnStartSeq: null,
      }),
    ).toEqual({ kind: "working", text: "Agent is working…" });
  });

  it("shows working for idle running sessions without agentBusy", () => {
    expect(
      resolveAgentSessionBanner({
        status: "running",
        agentBusy: false,
        isDeploying: false,
        errorMessage: null,
        failedTurnStartSeq: null,
      }),
    ).toEqual({ kind: "working", text: "Agent is working…" });
  });

  it("prioritizes deploying over other states", () => {
    expect(
      resolveAgentSessionBanner({
        status: "deploying",
        agentBusy: false,
        isDeploying: true,
        errorMessage: null,
        failedTurnStartSeq: null,
      }),
    ).toEqual({
      kind: "working",
      text: "Rebuilding and releasing containers…",
    });
  });
});

describe("isStuckActiveSession", () => {
  it("detects a failed turn left in running state", () => {
    expect(
      isStuckActiveSession({
        status: "running",
        failedTurnStartSeq: 3,
        hasActiveProcess: false,
        projectMarkedActive: true,
      }),
    ).toBe(true);
  });

  it("allows idle running sessions between turns", () => {
    expect(
      isStuckActiveSession({
        status: "running",
        failedTurnStartSeq: null,
        hasActiveProcess: false,
        projectMarkedActive: true,
      }),
    ).toBe(false);
  });

  it("detects pending sessions abandoned after restart", () => {
    expect(
      isStuckActiveSession({
        status: "pending",
        failedTurnStartSeq: null,
        hasActiveProcess: false,
        projectMarkedActive: false,
      }),
    ).toBe(true);
  });

  it("allows pending sessions that are starting", () => {
    expect(
      isStuckActiveSession({
        status: "pending",
        failedTurnStartSeq: null,
        hasActiveProcess: false,
        projectMarkedActive: true,
      }),
    ).toBe(false);
  });
});
