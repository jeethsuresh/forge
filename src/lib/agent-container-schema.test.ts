import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import {
  agentContainers,
  agentSessions,
  projects,
  secretRequests,
  secrets,
} from "@/lib/db/schema";

function insertProject(): string {
  const projectId = randomUUID();
  db.insert(projects)
    .values({
      id: projectId,
      name: "Agent Container Schema",
      githubRepo: "owner/agent-container-schema",
      branch: "main",
      clonePath: "/tmp/agent-container-schema",
      enabled: true,
      deployEnvJson: "[]",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
  return projectId;
}

function insertSession(projectId: string): string {
  const sessionId = randomUUID();
  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId,
      branch: "agent/test",
      status: "running",
      initialPrompt: "test",
      source: "manual",
      logs: "",
      startedAt: new Date(),
    })
    .run();
  return sessionId;
}

describe("agent containers and secrets schema", () => {
  it("inserts and selects agent_containers rows", () => {
    const projectId = insertProject();
    const sessionId = insertSession(projectId);
    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + 2 * 60 * 60 * 1000);

    db.insert(agentContainers)
      .values({
        sessionId,
        containerId: "abc123",
        image: "forge-agent:latest",
        status: "running",
        lastHeartbeatAt: startedAt,
        lastActivityAt: startedAt,
        startedAt,
        deadlineAt,
        killReason: null,
      })
      .run();

    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();

    expect(row?.containerId).toBe("abc123");
    expect(row?.image).toBe("forge-agent:latest");
    expect(row?.status).toBe("running");
    expect(row?.killReason).toBeNull();
    expect(row?.deadlineAt).toBeInstanceOf(Date);
    expect(Math.abs((row?.deadlineAt?.getTime() ?? 0) - deadlineAt.getTime())).toBeLessThan(
      2000,
    );
  });

  it("inserts and selects secrets and secret_requests", () => {
    const projectId = insertProject();
    const sessionId = insertSession(projectId);
    const secretId = randomUUID();
    const requestId = randomUUID();
    const createdAt = new Date();

    db.insert(secrets)
      .values({
        id: secretId,
        scope: "project",
        projectId,
        name: "NPM_TOKEN",
        ciphertext: "enc:deadbeef",
        createdAt,
      })
      .run();

    db.insert(secrets)
      .values({
        id: randomUUID(),
        scope: "global",
        projectId: null,
        name: "GITHUB_TOKEN",
        ciphertext: "enc:cafe",
        createdAt,
      })
      .run();

    db.insert(secretRequests)
      .values({
        id: requestId,
        sessionId,
        projectId,
        name: "NPM_TOKEN",
        allowed: true,
        reason: "granted for package install",
        createdAt,
      })
      .run();

    const secret = db
      .select()
      .from(secrets)
      .where(eq(secrets.id, secretId))
      .get();
    expect(secret?.scope).toBe("project");
    expect(secret?.name).toBe("NPM_TOKEN");
    expect(secret?.ciphertext).toBe("enc:deadbeef");

    const request = db
      .select()
      .from(secretRequests)
      .where(eq(secretRequests.id, requestId))
      .get();
    expect(request?.allowed).toBe(true);
    expect(request?.sessionId).toBe(sessionId);
    expect(request?.reason).toBe("granted for package install");
  });
});
