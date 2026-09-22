import { describe, expect, it } from "vitest";
import {
  AGENT_RESTART_PROMPT_MAX_CHARS,
  buildAgentRestartPrompt,
} from "@/lib/agent-restart-transcript";

function ev(
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
) {
  return { seq, eventType, payload: JSON.stringify(payload) };
}

describe("buildAgentRestartPrompt", () => {
  it("includes the original instruction, user, assistant, and an incomplete last turn", () => {
    const prompt = buildAgentRestartPrompt({
      initialPrompt: "Add a health endpoint",
      events: [
        ev(1, "user", { type: "user", text: "Add a health endpoint" }),
        ev(2, "assistant", {
          type: "assistant",
          text: "I will add GET /health.",
        }),
        ev(3, "user", { type: "user", text: "Also return the git sha" }),
        ev(4, "assistant", {
          type: "assistant",
          text: "Working on the sha field now",
        }),
      ],
    });
    expect(prompt).toContain("replacing a previous agent");
    expect(prompt).toContain("Add a health endpoint");
    expect(prompt).toContain("Also return the git sha");
    expect(prompt).toContain("Working on the sha field now");
    expect(prompt).toContain("incomplete");
    expect(prompt.length).toBeLessThanOrEqual(AGENT_RESTART_PROMPT_MAX_CHARS);
  });

  it("summarizes tools as one-liners instead of dumping payloads", () => {
    const prompt = buildAgentRestartPrompt({
      initialPrompt: "edit",
      events: [
        ev(1, "tool_call", {
          type: "tool_call",
          subtype: "started",
          call_id: "tool_1",
          tool_call: {
            writeToolCall: { args: { path: "src/app.ts" } },
          },
        }),
      ],
    });
    expect(prompt).toMatch(/tool/i);
    expect(prompt).toContain("src/app.ts");
    expect(prompt).not.toContain("writeToolCall");
  });

  it("keeps the header and the tail when over the character cap", () => {
    const huge = "x".repeat(2000) + " LATEST_TURN_MARKER";
    const prompt = buildAgentRestartPrompt({
      initialPrompt: "go",
      maxChars: 600,
      events: [
        ev(1, "assistant", { type: "assistant", text: "EARLY " + "y".repeat(2000) }),
        ev(2, "assistant", { type: "assistant", text: huge }),
      ],
    });
    expect(prompt.length).toBeLessThanOrEqual(600);
    expect(prompt).toContain("replacing a previous agent");
    expect(prompt).toContain("LATEST_TURN_MARKER");
    expect(prompt).not.toContain("EARLY");
  });
});
