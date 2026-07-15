import { describe, expect, it } from "vitest";
import {
  agentSessionSourceLabel,
  isIdleAgentSession,
  isInactiveAgentSessionStatus,
  resolveAgentSessionSource,
  shouldAutoCompleteRecoverySession,
} from "@/lib/agent-session-source";
import { RECOVERY_PROMPT_PREFIX } from "@/lib/agent-session-source";

describe("resolveAgentSessionSource", () => {
  it("prefers the stored source column", () => {
    expect(
      resolveAgentSessionSource({
        source: "recovery",
        initialPrompt: "hello",
      }),
    ).toBe("recovery");
  });

  it("infers recovery from the prompt prefix for legacy rows", () => {
    expect(
      resolveAgentSessionSource({
        initialPrompt: `${RECOVERY_PROMPT_PREFIX} fix deploy`,
      }),
    ).toBe("recovery");
  });

  it("defaults to manual", () => {
    expect(
      resolveAgentSessionSource({
        initialPrompt: "Add feature X",
      }),
    ).toBe("manual");
  });
});

describe("agent session activity helpers", () => {
  it("labels sources for the UI", () => {
    expect(agentSessionSourceLabel("manual")).toBe("Manual");
    expect(agentSessionSourceLabel("recovery")).toBe("Deploy recovery");
    expect(agentSessionSourceLabel("rebase-recovery")).toBe("Rebase recovery");
  });

  it("treats idle as inactive and non-blocking", () => {
    expect(isIdleAgentSession("idle")).toBe(true);
    expect(isInactiveAgentSessionStatus("idle")).toBe(true);
    expect(isInactiveAgentSessionStatus("running")).toBe(false);
  });
});

describe("shouldAutoCompleteRecoverySession", () => {
  it("is true for recovery sessions", () => {
    expect(
      shouldAutoCompleteRecoverySession({
        source: "recovery",
        initialPrompt: "ignored",
      }),
    ).toBe(true);
  });

  it("is true for legacy recovery prompts", () => {
    expect(
      shouldAutoCompleteRecoverySession({
        initialPrompt: `${RECOVERY_PROMPT_PREFIX} fix deploy`,
      }),
    ).toBe(true);
  });

  it("is false for manual sessions", () => {
    expect(
      shouldAutoCompleteRecoverySession({
        source: "manual",
        initialPrompt: "Add feature",
      }),
    ).toBe(false);
  });

  it("is true for rebase-recovery sessions", () => {
    expect(
      shouldAutoCompleteRecoverySession({
        source: "rebase-recovery",
        initialPrompt: "ignored",
      }),
    ).toBe(true);
  });
});
