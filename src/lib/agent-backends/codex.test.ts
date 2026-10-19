import { describe, expect, it } from "vitest";
import { codexBackend, translateCodexLine } from "@/lib/agent-backends/codex";

describe("codex adapter", () => {
  it("executes with xhigh reasoning", () => {
    const spec = codexBackend.containerSpec({
      thinking: codexBackend.resolveThinking("gpt-5.3-codex"),
      settings: {
        backend: "codex",
        model: "gpt-5.3-codex",
        baseUrl: "",
        hasApiKey: true,
        updatedAt: null,
      },
      apiKey: "sk-test",
    });
    expect(spec.args).toContain("exec");
    expect(spec.args).toContain("--json");
    expect(spec.args).toContain("-c");
    expect(spec.args).toContain("model_reasoning_effort=xhigh");
    expect(spec.env.OPENAI_API_KEY).toBe("sk-test");
  });

  it("translates thread start and agent messages into Forge stream events", () => {
    const started = translateCodexLine(
      JSON.stringify({ type: "thread.started", thread_id: "th_1" }),
    );
    expect(started.vendorSessionId).toBe("th_1");
    expect(JSON.parse(started.line)).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: "th_1",
    });

    const message = translateCodexLine(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "hello from codex" },
      }),
    );
    expect(JSON.parse(message.line)).toMatchObject({
      type: "assistant",
      message: { content: [{ type: "text", text: "hello from codex" }] },
    });
  });
});
