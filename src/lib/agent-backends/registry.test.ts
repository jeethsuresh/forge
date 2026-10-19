import { describe, expect, it } from "vitest";
import {
  requireBackend,
  resolveRequestedBackend,
} from "@/lib/agent-backends/registry";
import { isAgentBackendId, parseAgentBackendId } from "@/lib/agent-backends/types";

describe("backend registry", () => {
  it("parses known backend ids", () => {
    expect(isAgentBackendId("cursor")).toBe(true);
    expect(isAgentBackendId("codex")).toBe(true);
    expect(isAgentBackendId("local")).toBe(true);
    expect(isAgentBackendId("claude")).toBe(false);
    expect(parseAgentBackendId("nope")).toBeNull();
    expect(parseAgentBackendId("cursor")).toBe("cursor");
  });

  it("rejects unknown requested backends", () => {
    expect(() => resolveRequestedBackend("claude")).toThrow(/Unknown agent backend/);
  });

  it("defaults to cursor when nothing is requested and nothing is available", () => {
    expect(resolveRequestedBackend(null)).toBe("cursor");
  });

  it("rejects an unavailable explicit backend", () => {
    const prevUrl = process.env.FORGE_LOCAL_AGENT_BASE_URL;
    const prevModel = process.env.FORGE_LOCAL_AGENT_MODEL;
    delete process.env.FORGE_LOCAL_AGENT_BASE_URL;
    delete process.env.FORGE_LOCAL_AGENT_MODEL;
    try {
      expect(() => requireBackend("local")).toThrow(/base URL is not set/i);
      expect(() => resolveRequestedBackend("local")).toThrow(/base URL is not set/i);
    } finally {
      if (prevUrl === undefined) delete process.env.FORGE_LOCAL_AGENT_BASE_URL;
      else process.env.FORGE_LOCAL_AGENT_BASE_URL = prevUrl;
      if (prevModel === undefined) delete process.env.FORGE_LOCAL_AGENT_MODEL;
      else process.env.FORGE_LOCAL_AGENT_MODEL = prevModel;
    }
  });
});
