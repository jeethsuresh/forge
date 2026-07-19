import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  authenticateOpsRequest,
  isOpsApiConfigured,
  mintSessionOpsToken,
  opsApiBaseUrl,
  verifyOpsApiToken,
} from "@/lib/ops-api-auth";
import {
  MIN_ACTION_DESCRIPTION_LENGTH,
  parseActionDescription,
  recordOpsAction,
  validateActionDescription,
} from "@/lib/ops-api-actions";
import {
  buildForgeOpsAgentInstructions,
  forgeOpsApiCatalog,
} from "@/lib/agent-ops-prompt";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";

describe("ops-api-auth", () => {
  let previousToken: string | undefined;
  let previousBase: string | undefined;
  let previousPort: string | undefined;
  let previousSessionSecret: string | undefined;

  beforeEach(() => {
    previousToken = process.env.FORGE_OPS_API_TOKEN;
    previousBase = process.env.FORGE_OPS_API_BASE;
    previousPort = process.env.PORT;
    previousSessionSecret = process.env.FORGE_OPS_SESSION_SECRET;
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.FORGE_OPS_API_TOKEN;
    else process.env.FORGE_OPS_API_TOKEN = previousToken;
    if (previousBase === undefined) delete process.env.FORGE_OPS_API_BASE;
    else process.env.FORGE_OPS_API_BASE = previousBase;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    if (previousSessionSecret === undefined) {
      delete process.env.FORGE_OPS_SESSION_SECRET;
    } else {
      process.env.FORGE_OPS_SESSION_SECRET = previousSessionSecret;
    }
  });

  it("is configured when session secret exists even without global token", () => {
    delete process.env.FORGE_OPS_API_TOKEN;
    process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
    expect(isOpsApiConfigured()).toBe(true);
  });

  it("is configured when global token is set", () => {
    process.env.FORGE_OPS_API_TOKEN = "secret";
    expect(isOpsApiConfigured()).toBe(true);
  });

  it("verifies bearer and header global tokens", () => {
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

  it("mints stable fos tokens and authenticates them for live sessions", () => {
    process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
    delete process.env.FORGE_OPS_API_TOKEN;

    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();

    db.insert(projects)
      .values({
        id: projectId,
        name: "Ops Token Project",
        githubRepo: "acme/ops-token",
        branch: "main",
        clonePath: "/tmp/ops-token-project",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "running",
        initialPrompt: "test",
        source: "manual",
        logs: "",
        startedAt: now,
      })
      .run();

    try {
      const token = mintSessionOpsToken(sessionId, projectId);
      expect(token.startsWith(`fos.${sessionId}.`)).toBe(true);
      expect(mintSessionOpsToken(sessionId, projectId)).toBe(token);

      const auth = authenticateOpsRequest(
        new Request("http://localhost", {
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      expect(auth).toEqual({
        kind: "session",
        sessionId,
        projectId,
      });
    } finally {
      db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
      db.delete(projects).where(eq(projects.id, projectId)).run();
    }
  });

  it("rejects session tokens for archived sessions", () => {
    process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
    delete process.env.FORGE_OPS_API_TOKEN;

    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();

    db.insert(projects)
      .values({
        id: projectId,
        name: "Archived Ops Project",
        githubRepo: "acme/archived-ops",
        branch: "main",
        clonePath: "/tmp/archived-ops-project",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "completed",
        initialPrompt: "test",
        source: "manual",
        logs: "",
        startedAt: now,
        archivedAt: now,
      })
      .run();

    try {
      const token = mintSessionOpsToken(sessionId, projectId);
      expect(
        authenticateOpsRequest(
          new Request("http://localhost", {
            headers: { authorization: `Bearer ${token}` },
          }),
        ),
      ).toBeNull();
    } finally {
      db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
      db.delete(projects).where(eq(projects.id, projectId)).run();
    }
  });

  it("still accepts global bearer token", () => {
    process.env.FORGE_OPS_API_TOKEN = "global-secret";
    process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
    const auth = authenticateOpsRequest(
      new Request("http://localhost", {
        headers: { authorization: "Bearer global-secret" },
      }),
    );
    expect(auth).toEqual({ kind: "global" });
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
    expect(text).toContain("rebase/finalize");
    expect(text).toContain("NEVER run Forge's own");
    expect(text).toContain("deploy.sh");
    expect(text).toContain("Recovery agent sessions");
    expect(text).toContain("revertChanges");
  });

  it("never warns that FORGE_OPS_API_TOKEN is not configured", () => {
    delete process.env.FORGE_OPS_API_TOKEN;
    process.env.FORGE_OPS_SESSION_SECRET = "test-session-secret-value";
    const text = buildForgeOpsAgentInstructions("proj-1", "sess-1");
    expect(text).not.toContain("WARNING: FORGE_OPS_API_TOKEN is not configured");
    expect(text).toContain(
      "The token is available in your environment as FORGE_OPS_API_TOKEN.",
    );
  });

  it("catalog includes agent session end for recovery and manual sessions", () => {
    const catalog = forgeOpsApiCatalog("http://example.test");
    const paths = catalog.endpoints.map((e) => e.path);
    expect(paths).toContain(
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/end",
    );
    expect(paths).toContain(
      "/api/ops/projects/{projectId}/agent-sessions/{sessionId}/stop",
    );
    expect(catalog.auth.sessionTokens).toMatch(/fos\./);
  });
});
