import { describe, expect, it } from "vitest";
import {
  eventsToDisplayMessages,
  mergeAssistantDeltas,
  streamEventToDisplay,
} from "@/lib/agent-stream";

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
      tool_call: {
        writeToolCall: { args: { path: "src/app.ts" } },
      },
      timestamp_ms: 2000,
    };
    const msg = streamEventToDisplay(event, 2);
    expect(msg?.role).toBe("tool");
    expect(msg?.content).toContain("write");
    expect(msg?.content).toContain("src/app.ts");
    expect(msg?.toolStatus).toBe("started");
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
});
