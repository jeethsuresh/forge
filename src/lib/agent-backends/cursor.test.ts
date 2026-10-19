import { describe, expect, it } from "vitest";
import { cursorBackend } from "@/lib/agent-backends/cursor";

describe("cursor adapter", () => {
  it("pins extra-high on the model flag and resumes via argv", () => {
    const spec = cursorBackend.containerSpec({
      resumeSessionId: "sess-1",
      thinking: cursorBackend.resolveThinking("gpt-5.5"),
      settings: {
        backend: "cursor",
        model: "gpt-5.5",
        baseUrl: "",
        hasApiKey: true,
        updatedAt: null,
      },
      apiKey: "crsr_test",
    });
    expect(spec.args).toContain("--model");
    expect(spec.args).toContain("gpt-5.5-extra-high");
    expect(spec.args).toContain("--resume");
    expect(spec.args).toContain("sess-1");
    expect(spec.env.CURSOR_API_KEY).toBe("crsr_test");
    expect(JSON.parse(spec.env.FORGE_AGENT_ARGS_JSON)).toEqual(spec.args);
  });

  it("parses Cursor init session ids", () => {
    const parsed = cursorBackend.parseVendorLine(
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "cursor-abc",
      }),
    );
    expect(parsed?.vendorSessionId).toBe("cursor-abc");
    expect(parsed?.eventType).toBe("system");
  });
});
