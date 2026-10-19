import { describe, expect, it } from "vitest";
import {
  codexReasoningArgs,
  cursorModelCandidates,
  localReasoningEfforts,
  pickCursorThinkingModel,
} from "@/lib/agent-backends/thinking";

describe("cursor thinking models", () => {
  it("prefers extra-high then high for GPT-family models", () => {
    const candidates = cursorModelCandidates("gpt-5.5");
    expect(candidates.map((c) => c.modelId)).toEqual([
      "gpt-5.5-extra-high",
      "gpt-5.5-high",
    ]);
    expect(candidates[0]?.level).toBe("xhigh");
    expect(candidates[1]?.level).toBe("high");
  });

  it("defaults an empty model to gpt-5.5 extra-high", () => {
    expect(cursorModelCandidates("")[0]?.modelId).toBe("gpt-5.5-extra-high");
  });

  it("uses thinking-high for Claude models", () => {
    const candidates = cursorModelCandidates("claude-opus-4-7");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.modelId).toBe("claude-opus-4-7-thinking-high");
    expect(candidates[0]?.level).toBe("high");
  });

  it("passes through a model that already has a thinking suffix", () => {
    const candidates = cursorModelCandidates("gpt-5.5-extra-high");
    expect(candidates).toEqual([
      {
        level: "xhigh",
        modelId: "gpt-5.5-extra-high",
        extraArgs: ["--model", "gpt-5.5-extra-high"],
      },
    ]);
  });

  it("picks extra-high from a list-models result when present", () => {
    const picked = pickCursorThinkingModel("gpt-5.5", [
      "gpt-5.5",
      "gpt-5.5-high",
      "gpt-5.5-extra-high",
    ]);
    expect(picked.modelId).toBe("gpt-5.5-extra-high");
    expect(picked.level).toBe("xhigh");
  });

  it("falls back to high when extra-high is not advertised", () => {
    const picked = pickCursorThinkingModel("gpt-5.5", [
      "gpt-5.5",
      "gpt-5.5-high",
    ]);
    expect(picked.modelId).toBe("gpt-5.5-high");
    expect(picked.level).toBe("high");
  });
});

describe("codex and local thinking", () => {
  it("emits Codex xhigh config flags", () => {
    expect(codexReasoningArgs("xhigh")).toEqual([
      "-c",
      "model_reasoning_effort=xhigh",
    ]);
  });

  it("tries local xhigh then high", () => {
    expect(localReasoningEfforts()).toEqual(["xhigh", "high"]);
  });
});
