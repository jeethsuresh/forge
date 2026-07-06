import { describe, expect, it } from "vitest";
import {
  eventsToDisplayMessages,
  formatToolDuration,
  groupMessagesForDisplay,
  mergeAssistantDeltas,
  mergeIncomingMessages,
  mergeToolCallMessages,
  mergeToolIntoExisting,
  streamEventToDisplay,
  summarizeToolCluster,
  toolStatusLabel,
} from "@/lib/agent-stream";

const SHELL_STARTED = {
  type: "tool_call",
  subtype: "started",
  call_id: "tool_test-1",
  tool_call: {
    shellToolCall: {
      args: { command: "ls -la", workingDirectory: "/tmp" },
    },
    toolCallId: "tool_test-1",
    startedAtMs: "1000",
  },
  timestamp_ms: 1000,
};

const SHELL_COMPLETED = {
  type: "tool_call",
  subtype: "completed",
  call_id: "tool_test-1",
  tool_call: {
    shellToolCall: {
      args: { command: "ls -la", workingDirectory: "/tmp" },
      result: {
        success: {
          command: "ls -la",
          exitCode: 0,
          stdout: "file.txt",
          stderr: "",
          executionTime: 120,
        },
      },
    },
    toolCallId: "tool_test-1",
    startedAtMs: "1000",
    completedAtMs: "1120",
  },
  timestamp_ms: 1120,
};

describe("streamEventToDisplay", () => {
  it("maps user events to display messages", () => {
    const event = {
      type: "user",
      message: { content: [{ type: "text", text: "Fix the bug" }] },
      timestamp_ms: 1000,
    };
    const msg = streamEventToDisplay(event, 1);
    expect(msg).toEqual({
      id: "user-1",
      role: "user",
      content: "Fix the bug",
      timestamp: 1000,
    });
  });

  it("maps tool call started events", () => {
    const event = {
      type: "tool_call",
      subtype: "started",
      call_id: "tool_abc",
      tool_call: {
        writeToolCall: { args: { path: "src/app.ts" } },
        toolCallId: "tool_abc",
      },
      timestamp_ms: 2000,
    };
    const msg = streamEventToDisplay(event, 2);
    expect(msg?.role).toBe("tool");
    expect(msg?.content).toBe("write: src/app.ts");
    expect(msg?.toolStatus).toBe("started");
    expect(msg?.toolCallId).toBe("tool_abc");
    expect(msg?.toolArgs).toEqual({ path: "src/app.ts" });
  });

  it("maps tool call completed events with result and duration", () => {
    const msg = streamEventToDisplay(SHELL_COMPLETED, 3);
    expect(msg?.toolStatus).toBe("completed");
    expect(msg?.toolResultText).toContain("file.txt");
    expect(msg?.toolDurationMs).toBe(120);
    expect(msg?.content).toContain("ls -la");
  });
});

describe("mergeToolCallMessages", () => {
  it("pairs started and completed events by call_id", () => {
    const started = streamEventToDisplay(SHELL_STARTED, 1)!;
    const completed = streamEventToDisplay(SHELL_COMPLETED, 2)!;
    const merged = mergeToolCallMessages([started, completed]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.toolStatus).toBe("completed");
    expect(merged[0]?.toolResultText).toContain("file.txt");
    expect(merged[0]?.toolDurationMs).toBe(120);
  });

  it("keeps unrelated tool messages separate", () => {
    const a = streamEventToDisplay(
      {
        ...SHELL_STARTED,
        call_id: "tool_a",
        tool_call: {
          ...SHELL_STARTED.tool_call,
          toolCallId: "tool_a",
        },
      },
      1,
    )!;
    const b = streamEventToDisplay(
      {
        ...SHELL_STARTED,
        call_id: "tool_b",
        tool_call: {
          ...SHELL_STARTED.tool_call,
          toolCallId: "tool_b",
        },
      },
      2,
    )!;
    const merged = mergeToolCallMessages([a, b]);
    expect(merged).toHaveLength(2);
  });
});

describe("mergeToolIntoExisting", () => {
  it("upgrades started to completed and fills in result", () => {
    const started = streamEventToDisplay(SHELL_STARTED, 1)!;
    const completed = streamEventToDisplay(SHELL_COMPLETED, 2)!;
    const merged = mergeToolIntoExisting(started, completed);
    expect(merged.toolStatus).toBe("completed");
    expect(merged.toolResultText).toContain("file.txt");
    expect(merged.id).toBe(started.id);
  });
});

describe("mergeAssistantDeltas", () => {
  it("concatenates consecutive assistant messages", () => {
    const merged = mergeAssistantDeltas([
      { id: "assistant-1", role: "assistant", content: "Hello ", timestamp: 1 },
      { id: "assistant-2", role: "assistant", content: "world", timestamp: 2 },
      { id: "user-3", role: "user", content: "Hi", timestamp: 3 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.content).toBe("Hello world");
  });

  it("handles stream-json partial chunks followed by a final snapshot", () => {
    const merged = mergeAssistantDeltas([
      { id: "assistant-1", role: "assistant", content: "hello", timestamp: 1 },
      { id: "assistant-2", role: "assistant", content: " world", timestamp: 2 },
      { id: "assistant-3", role: "assistant", content: "hello world", timestamp: 3 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("hello world");
  });
});

describe("mergeIncomingMessages", () => {
  it("appends streamed assistant deltas from SSE batches", () => {
    const merged = mergeIncomingMessages(
      [{ id: "assistant-1", role: "assistant", content: "hello", timestamp: 1 }],
      [{ id: "assistant-2", role: "assistant", content: " world", timestamp: 2 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("hello world");
  });

  it("deduplicates optimistic user messages", () => {
    const merged = mergeIncomingMessages(
      [{ id: "user-1", role: "user", content: "Fix it", timestamp: 1 }],
      [{ id: "user-2", role: "user", content: "Fix it", timestamp: 2 }],
    );
    expect(merged).toHaveLength(1);
  });

  it("merges completed tool updates into existing started rows", () => {
    const started = streamEventToDisplay(SHELL_STARTED, 1)!;
    const completed = streamEventToDisplay(SHELL_COMPLETED, 2)!;
    const merged = mergeIncomingMessages([started], [completed]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.toolStatus).toBe("completed");
    expect(merged[0]?.toolResultText).toContain("file.txt");
  });

  it("merges cumulative assistant snapshots from SSE batches", () => {
    const merged = mergeIncomingMessages(
      [{ id: "assistant-1", role: "assistant", content: "hello", timestamp: 1 }],
      [{ id: "assistant-5", role: "assistant", content: "hello world", timestamp: 5 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("hello world");
  });
});

describe("groupMessagesForDisplay", () => {
  const tool = (
    id: string,
    content: string,
    toolName?: string,
    toolStatus?: "started" | "completed",
  ) => ({
    id,
    role: "tool" as const,
    content,
    toolName,
    toolStatus,
    timestamp: 1,
  });

  it("leaves non-tool messages as single items", () => {
    const items = groupMessagesForDisplay([
      { id: "user-1", role: "user", content: "Hi", timestamp: 1 },
      { id: "assistant-2", role: "assistant", content: "Hello", timestamp: 2 },
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === "message")).toBe(true);
  });

  it("keeps a lone tool as a message item", () => {
    const items = groupMessagesForDisplay([tool("tool-1", "read: foo.ts", "read")]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "message", message: { id: "tool-1" } });
  });

  it("clusters consecutive tool messages", () => {
    const items = groupMessagesForDisplay([
      tool("tool-1", "read: a.ts", "read", "completed"),
      tool("tool-2", "write: b.ts", "write", "completed"),
      tool("tool-3", "shell", "shell", "started"),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("tool-cluster");
    if (items[0]?.kind === "tool-cluster") {
      expect(items[0].tools).toHaveLength(3);
      expect(items[0].hasActive).toBe(true);
    }
  });

  it("splits clusters around other message types", () => {
    const items = groupMessagesForDisplay([
      tool("tool-1", "read: a.ts", "read"),
      tool("tool-2", "write: b.ts", "write"),
      { id: "assistant-3", role: "assistant", content: "Done", timestamp: 3 },
      tool("tool-4", "grep: pattern", "grep"),
    ]);
    expect(items).toHaveLength(3);
    expect(items[0]?.kind).toBe("tool-cluster");
    expect(items[1]?.kind).toBe("message");
    expect(items[2]?.kind).toBe("message");
  });
});

describe("summarizeToolCluster", () => {
  it("lists unique tool names", () => {
    const summary = summarizeToolCluster([
      { id: "1", role: "tool", content: "read: a", toolName: "read", timestamp: 1 },
      { id: "2", role: "tool", content: "write: b", toolName: "write", timestamp: 2 },
      { id: "3", role: "tool", content: "read: c", toolName: "read", timestamp: 3 },
    ]);
    expect(summary).toBe("read, write");
  });

  it("truncates long name lists", () => {
    const summary = summarizeToolCluster([
      { id: "1", role: "tool", content: "a", toolName: "read", timestamp: 1 },
      { id: "2", role: "tool", content: "b", toolName: "write", timestamp: 2 },
      { id: "3", role: "tool", content: "c", toolName: "shell", timestamp: 3 },
      { id: "4", role: "tool", content: "d", toolName: "grep", timestamp: 4 },
    ]);
    expect(summary).toBe("read, write +2");
  });
});

describe("eventsToDisplayMessages", () => {
  it("parses stored event payloads into messages", () => {
    const messages = eventsToDisplayMessages([
      {
        seq: 1,
        eventType: "user",
        payload: JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text: "Do it" }] },
          timestamp_ms: 1,
        }),
      },
      {
        seq: 2,
        eventType: "result",
        payload: JSON.stringify({ type: "result", duration_ms: 5000, timestamp_ms: 2 }),
      },
    ]);
    expect(messages.some((m) => m.role === "user" && m.content === "Do it")).toBe(true);
    expect(messages.some((m) => m.role === "system")).toBe(true);
  });

  it("merges tool call started/completed pairs from stored events", () => {
    const messages = eventsToDisplayMessages([
      { seq: 1, eventType: "tool_call", payload: JSON.stringify(SHELL_STARTED) },
      { seq: 2, eventType: "tool_call", payload: JSON.stringify(SHELL_COMPLETED) },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolStatus).toBe("completed");
    expect(messages[0]?.toolResultText).toContain("file.txt");
  });

  it("merges partial assistant stream-json chunks", () => {
    const messages = eventsToDisplayMessages([
      {
        seq: 1,
        eventType: "assistant",
        payload: JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
          timestamp_ms: 1,
        }),
      },
      {
        seq: 2,
        eventType: "assistant",
        payload: JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: " world" }] },
          timestamp_ms: 2,
        }),
      },
      {
        seq: 3,
        eventType: "assistant",
        payload: JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "hello world" }] },
        }),
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("hello world");
  });

  it("parses partial assistant chunks that only use text", () => {
    const messages = eventsToDisplayMessages([
      {
        seq: 1,
        eventType: "assistant",
        payload: JSON.stringify({
          type: "assistant",
          text: "hel",
          timestamp_ms: 1,
        }),
      },
      {
        seq: 2,
        eventType: "assistant",
        payload: JSON.stringify({
          type: "assistant",
          text: "lo",
          timestamp_ms: 2,
        }),
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("hello");
  });
});

describe("formatToolDuration", () => {
  it("formats sub-second durations in ms", () => {
    expect(formatToolDuration(250)).toBe("250ms");
  });

  it("formats longer durations in seconds", () => {
    expect(formatToolDuration(1500)).toBe("1.5s");
  });
});

describe("toolStatusLabel", () => {
  it("labels running and completed tools", () => {
    expect(
      toolStatusLabel({
        id: "1",
        role: "tool",
        content: "read",
        toolStatus: "started",
        timestamp: 1,
      }),
    ).toBe("running");
    expect(
      toolStatusLabel({
        id: "2",
        role: "tool",
        content: "read",
        toolStatus: "completed",
        timestamp: 2,
      }),
    ).toBe("completed");
  });

  it("labels errored tools", () => {
    expect(
      toolStatusLabel({
        id: "3",
        role: "tool",
        content: "shell",
        toolStatus: "completed",
        toolError: "failed",
        timestamp: 3,
      }),
    ).toBe("error");
  });
});
