import { describe, expect, it } from "vitest";
import {
  canRetryFailedAgentTurn,
  failedTurnEventSeq,
  filterEventsBeforeSeq,
  findFailedTurnPrompt,
  isAgentTurnComplete,
  isSessionTurnFailed,
  isStuckActiveSession,
  isTerminalSessionStatus,
  parseStoredUserEventPrompt,
  resolveAgentSessionBanner,
  staleAgentSessionFailureMessage,
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

describe("resolveAgentSessionBanner", () => {
  it("shows failure for failed sessions", () => {
    expect(
      resolveAgentSessionBanner({
        status: "failed",
        hasActiveProcess: true,
        isDeploying: false,
        errorMessage: "Agent exited with code 1",
        canRetry: true,
      }),
    ).toEqual({
      kind: "failed",
      text: "Agent exited with code 1",
      canRetry: true,
    });
  });

  it("shows working only when a cursor process is running", () => {
    expect(
      resolveAgentSessionBanner({
        status: "running",
        hasActiveProcess: true,
        isDeploying: false,
        errorMessage: null,
        canRetry: false,
      }),
    ).toEqual({ kind: "working", text: "Agent is working…" });
  });

  it("hides the working banner without an active process", () => {
    expect(
      resolveAgentSessionBanner({
        status: "running",
        hasActiveProcess: false,
        isDeploying: false,
        errorMessage: null,
        canRetry: false,
      }),
    ).toBeNull();

    expect(
      resolveAgentSessionBanner({
        status: "pending",
        hasActiveProcess: false,
        isDeploying: false,
        errorMessage: null,
        canRetry: false,
      }),
    ).toBeNull();
  });

  it("prioritizes deploying over other states", () => {
    expect(
      resolveAgentSessionBanner({
        status: "deploying",
        hasActiveProcess: false,
        isDeploying: true,
        errorMessage: null,
        canRetry: false,
      }),
    ).toEqual({
      kind: "working",
      text: "Rebuilding and releasing containers…",
    });
  });
});

describe("canRetryFailedAgentTurn", () => {
  it("allows retry when an agent turn failed mid-flight", () => {
    expect(
      canRetryFailedAgentTurn(
        { status: "failed", failedTurnStartSeq: 3, deploymentId: null },
        EVENTS,
      ),
    ).toBe(true);
  });

  it("allows retry when failedTurnStartSeq is inferred from events", () => {
    expect(
      canRetryFailedAgentTurn(
        { status: "failed", failedTurnStartSeq: null, deploymentId: null },
        EVENTS,
      ),
    ).toBe(true);
  });

  it("disallows retry for deploy failures after a completed turn", () => {
    expect(
      canRetryFailedAgentTurn(
        { status: "failed", failedTurnStartSeq: null, deploymentId: "dep-1" },
        [
          ...EVENTS,
          {
            seq: 5,
            eventType: "result",
            payload: JSON.stringify({ type: "result", duration_ms: 1000 }),
          },
        ],
      ),
    ).toBe(false);
  });
});

describe("isAgentTurnComplete", () => {
  it("is true when a result event follows the last user event", () => {
    expect(
      isAgentTurnComplete([
        ...EVENTS,
        {
          seq: 5,
          eventType: "result",
          payload: JSON.stringify({ type: "result", duration_ms: 1000 }),
        },
      ]),
    ).toBe(true);
  });

  it("is false while a turn is still in progress", () => {
    expect(isAgentTurnComplete(EVENTS)).toBe(false);
  });
});

describe("isStuckActiveSession", () => {
  it("detects a turn left incomplete in running state", () => {
    expect(
      isStuckActiveSession({
        status: "running",
        failedTurnStartSeq: 3,
        hasActiveProcess: false,
        projectMarkedActive: true,
        turnIncomplete: true,
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
        turnIncomplete: false,
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

describe("staleAgentSessionFailureMessage", () => {
  it("describes pending sessions that never started", () => {
    expect(staleAgentSessionFailureMessage("pending")).toMatch(/did not start/i);
    expect(staleAgentSessionFailureMessage("pending")).toMatch(/orchestrator restarted/i);
  });

  it("describes incomplete running turns with retry guidance", () => {
    expect(staleAgentSessionFailureMessage("running")).toMatch(/did not finish/i);
    expect(staleAgentSessionFailureMessage("running")).toMatch(/Retry/i);
  });

  it("adds recovery-specific guidance for recovery sessions", () => {
    const message = staleAgentSessionFailureMessage("running", { isRecovery: true });
    expect(message).toMatch(/Recovery agent turn/i);
    expect(message).toMatch(/uncommitted changes/i);
  });
});
