import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentEvents,
  agentSessions,
  projectForgefiles,
  projects,
  secretRequests,
} from "@/lib/db/schema";
import {
  encryptSecretValue,
  decryptSecretValue,
  isDeniedSecretName,
  listSecretRequestsForSession,
  requestProjectSecret,
  storeSecret,
} from "@/lib/agent-secrets";
import { ingestAgentEvents } from "@/lib/agent-events-ingest";
import {
  isBootstrapOpsPathAllowed,
  projectNeedsForgefileBootstrap,
} from "@/lib/ops-bootstrap-guard";

function seedProjectSession(): { projectId: string; sessionId: string } {
  const projectId = randomUUID();
  const sessionId = randomUUID();
  db.insert(projects)
    .values({
      id: projectId,
      name: "Secrets Test",
      githubRepo: "owner/secrets-test",
      branch: "main",
      clonePath: "/tmp/secrets-test",
      enabled: true,
      deployEnvJson: "[]",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId,
      branch: "agent/s",
      status: "running",
      initialPrompt: "hi",
      source: "manual",
      logs: "",
      startedAt: new Date(),
    })
    .run();
  return { projectId, sessionId };
}

describe("hybrid secrets", () => {
  it("encrypts and decrypts secret values", () => {
    const cipher = encryptSecretValue("super-secret");
    expect(cipher.startsWith("v1:")).toBe(true);
    expect(decryptSecretValue(cipher)).toBe("super-secret");
  });

  it("denies docker/host privileged secret names", () => {
    expect(isDeniedSecretName("DOCKER_HOST")).toBe(true);
    expect(isDeniedSecretName("DOCKER_SOCKET")).toBe(true);
    expect(isDeniedSecretName("HOST_PATH")).toBe(true);
    expect(isDeniedSecretName("NPM_TOKEN")).toBe(false);
  });

  it("audits allow and deny on requestProjectSecret", () => {
    const { projectId, sessionId } = seedProjectSession();
    storeSecret({
      scope: "project",
      projectId,
      name: "NPM_TOKEN",
      value: "npm_abc",
    });

    const denied = requestProjectSecret(sessionId, projectId, "DOCKER_SOCKET");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toMatch(/denied/i);

    const allowed = requestProjectSecret(sessionId, projectId, "NPM_TOKEN");
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) expect(allowed.value).toBe("npm_abc");

    const audit = listSecretRequestsForSession(sessionId);
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.some((r) => r.name === "DOCKER_SOCKET" && !r.allowed)).toBe(
      true,
    );
    expect(audit.some((r) => r.name === "NPM_TOKEN" && r.allowed)).toBe(true);

    const rows = db
      .select()
      .from(secretRequests)
      .where(eq(secretRequests.sessionId, sessionId))
      .all();
    expect(rows.length).toBe(audit.length);
  });
});

describe("agent event ingest", () => {
  it("appends events to agent_events", () => {
    const { sessionId } = seedProjectSession();
    const recorded = ingestAgentEvents(sessionId, [
      { type: "assistant", payload: { text: "hello" } },
      { line: JSON.stringify({ type: "system", subtype: "init", session_id: "c1" }) },
    ]);
    expect(recorded).toBe(2);

    const events = db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.sessionId, sessionId))
      .all();
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe("assistant");
    expect(events[1]?.eventType).toBe("system");
  });

  it("translates Codex vendor lines and records thinking=none", () => {
    const { sessionId } = seedProjectSession();
    db.update(agentSessions)
      .set({ backend: "codex" })
      .where(eq(agentSessions.id, sessionId))
      .run();

    ingestAgentEvents(sessionId, [
      {
        line: JSON.stringify({ type: "thread.started", thread_id: "th_codex" }),
      },
      {
        line: JSON.stringify({
          type: "system",
          subtype: "info",
          text: "thinking=none (model does not support reasoning)",
        }),
      },
    ]);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.backendSessionId).toBe("th_codex");
    expect(session?.cursorSessionId).toBeNull();
    expect(session?.thinkingLevel).toBe("none");

    const events = db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.sessionId, sessionId))
      .all();
    expect(JSON.parse(events[0]?.payload ?? "{}")).toMatchObject({
      type: "system",
      subtype: "init",
      session_id: "th_codex",
    });
  });
});

describe("bootstrap ops allowlist", () => {
  it("allows forgefile/heartbeat/events and denies deploy while invalid", () => {
    expect(
      isBootstrapOpsPathAllowed(
        "GET",
        "/api/ops/projects/p1/forgefile",
      ),
    ).toBe(true);
    expect(
      isBootstrapOpsPathAllowed(
        "POST",
        "/api/ops/projects/p1/agent-sessions/s1/heartbeat",
      ),
    ).toBe(true);
    expect(
      isBootstrapOpsPathAllowed(
        "POST",
        "/api/ops/projects/p1/agent-sessions/s1/events",
      ),
    ).toBe(true);
    expect(
      isBootstrapOpsPathAllowed("POST", "/api/ops/projects/p1/deploy"),
    ).toBe(false);
    expect(
      isBootstrapOpsPathAllowed(
        "POST",
        "/api/ops/projects/p1/scripts/build/run",
      ),
    ).toBe(false);
    expect(isBootstrapOpsPathAllowed("GET", "/api/ops/discover")).toBe(true);
    expect(isBootstrapOpsPathAllowed("GET", "/api/ops/search")).toBe(true);
    expect(isBootstrapOpsPathAllowed("GET", "/api/ops/tools")).toBe(true);
    expect(isBootstrapOpsPathAllowed("GET", "/api/ops/tools/ops.project.deploy")).toBe(
      true,
    );
    expect(
      isBootstrapOpsPathAllowed("POST", "/api/ops/tools/ops.project.deploy/call"),
    ).toBe(true);
    expect(isBootstrapOpsPathAllowed("POST", "/api/ops/mcp")).toBe(true);
  });

  it("projectNeedsForgefileBootstrap reflects projection status", () => {
    const { projectId } = seedProjectSession();
    expect(projectNeedsForgefileBootstrap(projectId)).toBe(true);

    db.insert(projectForgefiles)
      .values({
        projectId,
        status: "missing",
        parsedJson: "{}",
        updatedAt: new Date(),
      })
      .run();
    expect(projectNeedsForgefileBootstrap(projectId)).toBe(true);

    db.update(projectForgefiles)
      .set({ status: "valid", parsedJson: '{"version":1}' })
      .where(eq(projectForgefiles.projectId, projectId))
      .run();
    expect(projectNeedsForgefileBootstrap(projectId)).toBe(false);
  });
});
