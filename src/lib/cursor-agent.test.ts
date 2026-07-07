import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("resolveCursorAgentBin", () => {
  let previousAgentBin: string | undefined;

  beforeEach(() => {
    previousAgentBin = process.env.FORGE_AGENT_BIN;
  });

  afterEach(() => {
    if (previousAgentBin === undefined) {
      delete process.env.FORGE_AGENT_BIN;
    } else {
      process.env.FORGE_AGENT_BIN = previousAgentBin;
    }
  });

  it("uses FORGE_AGENT_BIN when set", async () => {
    process.env.FORGE_AGENT_BIN = "/bin/sh";
    const { resolveCursorAgentBin } = await import("@/lib/cursor-agent");
    expect(resolveCursorAgentBin()).toBe("/bin/sh");
  });

  it("throws when no agent binary is available", async () => {
    process.env.FORGE_AGENT_BIN = "/definitely/missing/agent";
    const { resolveCursorAgentBin } = await import("@/lib/cursor-agent");
    expect(() => resolveCursorAgentBin()).toThrow(/Cursor agent CLI is not available/);
  });
});
