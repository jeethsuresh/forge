import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isOpsApiConfigured,
  opsApiBaseUrl,
  verifyOpsApiToken,
} from "@/lib/ops-api-auth";
import {
  MIN_ACTION_DESCRIPTION_LENGTH,
  parseActionDescription,
  recordOpsAction,
  validateActionDescription,
} from "@/lib/ops-api-actions";
import { buildForgeOpsAgentInstructions } from "@/lib/agent-ops-prompt";

describe("ops-api-auth", () => {
  let previousToken: string | undefined;
  let previousBase: string | undefined;
  let previousPort: string | undefined;

  beforeEach(() => {
    previousToken = process.env.FORGE_OPS_API_TOKEN;
    previousBase = process.env.FORGE_OPS_API_BASE;
    previousPort = process.env.PORT;
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.FORGE_OPS_API_TOKEN;
    else process.env.FORGE_OPS_API_TOKEN = previousToken;
    if (previousBase === undefined) delete process.env.FORGE_OPS_API_BASE;
    else process.env.FORGE_OPS_API_BASE = previousBase;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  });

  it("detects configured token", () => {
    delete process.env.FORGE_OPS_API_TOKEN;
    expect(isOpsApiConfigured()).toBe(false);
    process.env.FORGE_OPS_API_TOKEN = "secret";
    expect(isOpsApiConfigured()).toBe(true);
  });

  it("verifies bearer and header tokens", () => {
    process.env.FORGE_OPS_API_TOKEN = "secret";
    expect(
      verifyOpsApiToken(
        new Request("http://localhost", {
          headers: { authorization: "Bearer secret" },
        }),
      ),
    ).toBe(true);
    expect(
      verifyOpsApiToken(
        new Request("http://localhost", {
          headers: { "x-forge-ops-token": "secret" },
        }),
      ),
    ).toBe(true);
    expect(verifyOpsApiToken(new Request("http://localhost"))).toBe(false);
  });

  it("derives ops API base URL", () => {
    delete process.env.FORGE_OPS_API_BASE;
    process.env.PORT = "3456";
    expect(opsApiBaseUrl()).toBe("http://127.0.0.1:3456");
    process.env.FORGE_OPS_API_BASE = "http://forge.local/";
    expect(opsApiBaseUrl()).toBe("http://forge.local");
  });
});

describe("ops-api-actions", () => {
  it("requires substantive action descriptions", () => {
    expect(validateActionDescription("short")).toMatch(/at least/);
    expect(validateActionDescription("  ")).toMatch(/at least/);
    const ok = "Deploying main after fixing login bug in PR #42.";
    expect(validateActionDescription(ok)).toBeNull();
    expect(parseActionDescription({ actionDescription: ok }).error).toBeNull();
  });

  it("records audited ops actions", () => {
    const id = recordOpsAction({
      actionDescription: "Testing audit log write for deploy action.",
      method: "POST",
      path: "/api/ops/projects/test/deploy",
      requestBody: { branch: "main" },
      responseStatus: 202,
      projectId: "project-1",
      resourceType: "deployment",
      resourceId: "dep-1",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("documents minimum action description length", () => {
    expect(MIN_ACTION_DESCRIPTION_LENGTH).toBeGreaterThanOrEqual(10);
  });
});

describe("agent-ops-prompt", () => {
  it("includes ops API usage and actionDescription requirement", () => {
    process.env.FORGE_OPS_API_TOKEN = "test-token";
    const text = buildForgeOpsAgentInstructions("proj-1", "sess-1");
    expect(text).toContain("actionDescription");
    expect(text).toContain("FORGE_OPS_API_TOKEN");
    expect(text).toContain("/api/ops/projects/proj-1");
    expect(text).toContain("sess-1");
  });
});
