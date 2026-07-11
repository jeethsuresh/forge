import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, deployments, projects } from "@/lib/db/schema";
import {
  activeAgentProjects,
  getBlockingAgentSession,
  isAgentSessionActive,
  reconcileProjectAgentSessions,
} from "@/lib/agent-state";

describe("reconcileProjectAgentSessions", () => {
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    projectId = randomUUID();
    sessionId = randomUUID();
    const now = new Date();

    db.insert(projects)
      .values({
        id: projectId,
        name: "demo",
        githubRepo: "acme/demo",
        branch: "main",
        clonePath: "/tmp/demo",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  afterEach(() => {
    activeAgentProjects.delete(projectId);
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("marks stale running sessions failed when no in-memory agent is active", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "running",
        initialPrompt: "do work",
        logs: "",
        startedAt: now,
      })
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(1);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("failed");
    expect(session?.completedAt).not.toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(false);
    expect(getBlockingAgentSession(projectId)).toBeNull();
  });

  it("finalizes deploying sessions when linked deployment completed", () => {
    const deploymentId = randomUUID();
    const now = new Date();

    db.insert(deployments)
      .values({
        id: deploymentId,
        projectId,
        commitSha: "abc123",
        branch: "main",
        status: "success",
        trigger: "agent",
        logs: "",
        startedAt: now,
        completedAt: now,
      })
      .run();

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "deploying",
        initialPrompt: "ship it",
        logs: "",
        deploymentId,
        startedAt: now,
      })
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(1);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("completed");
    expect(isAgentSessionActive(projectId)).toBe(false);
  });

  it("does not reconcile running sessions while in-memory agent is active", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "running",
        initialPrompt: "do work",
        logs: "",
        startedAt: now,
      })
      .run();

    activeAgentProjects.add(projectId);

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(0);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("running");
    expect(isAgentSessionActive(projectId)).toBe(true);
    expect(getBlockingAgentSession(projectId)?.id).toBe(sessionId);
  });
});
