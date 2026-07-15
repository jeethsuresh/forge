import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentEvents,
  agentSessions,
  deployments,
  projects,
} from "@/lib/db/schema";
import {
  activeAgentProjects,
  applyAgentDeploymentOutcome,
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
    db.delete(agentEvents).where(eq(agentEvents.sessionId, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(deployments).where(eq(deployments.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("marks incomplete running turns failed when no in-memory agent is active", () => {
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
    db.insert(agentEvents)
      .values({
        id: randomUUID(),
        sessionId,
        seq: 1,
        eventType: "user",
        payload: JSON.stringify({ type: "user", text: "do work" }),
        createdAt: now,
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
    expect(session?.errorMessage).toBe("Agent session interrupted");
    expect(session?.completedAt).not.toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(false);
    expect(getBlockingAgentSession(projectId)).toBeNull();
  });

  it("completes finished running sessions so deploys are not blocked", () => {
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
    db.insert(agentEvents)
      .values([
        {
          id: randomUUID(),
          sessionId,
          seq: 1,
          eventType: "user",
          payload: JSON.stringify({ type: "user", text: "do work" }),
          createdAt: now,
        },
        {
          id: randomUUID(),
          sessionId,
          seq: 2,
          eventType: "result",
          payload: JSON.stringify({ type: "result" }),
          createdAt: now,
        },
      ])
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(1);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("completed");
    expect(session?.completedAt).not.toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(false);
    expect(getBlockingAgentSession(projectId)).toBeNull();
  });

  it("completes finished recovery sessions so a new agent can start on the branch", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "running",
        source: "recovery",
        initialPrompt: "[deploy-recovery] fix deploy",
        logs: "",
        startedAt: now,
      })
      .run();
    db.insert(agentEvents)
      .values([
        {
          id: randomUUID(),
          sessionId,
          seq: 1,
          eventType: "user",
          payload: JSON.stringify({ type: "user", text: "[deploy-recovery] fix" }),
          createdAt: now,
        },
        {
          id: randomUUID(),
          sessionId,
          seq: 2,
          eventType: "result",
          payload: JSON.stringify({ type: "result" }),
          createdAt: now,
        },
      ])
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(1);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("completed");
    expect(session?.completedAt).not.toBeNull();
    expect(session?.errorMessage).toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(false);
    expect(getBlockingAgentSession(projectId)).toBeNull();
  });

  it("still fails incomplete recovery turns when no in-memory agent is active", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "running",
        source: "recovery",
        initialPrompt: "[deploy-recovery] fix deploy",
        logs: "",
        startedAt: now,
      })
      .run();
    db.insert(agentEvents)
      .values({
        id: randomUUID(),
        sessionId,
        seq: 1,
        eventType: "user",
        payload: JSON.stringify({ type: "user", text: "[deploy-recovery] fix" }),
        createdAt: now,
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
    expect(session?.errorMessage).toBe("Agent session interrupted");
    expect(isAgentSessionActive(projectId)).toBe(false);
  });

  it("does not overwrite a reactivated session when applying an old deployment outcome", () => {
    const deploymentId = randomUUID();
    const now = new Date();

    db.insert(deployments)
      .values({
        id: deploymentId,
        projectId,
        commitSha: "abc123",
        branch: "main",
        status: "failed",
        trigger: "agent",
        logs: "",
        errorMessage: "deploy blew up",
        startedAt: now,
        completedAt: now,
      })
      .run();

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "running",
        source: "recovery",
        initialPrompt: "[deploy-recovery] fix it",
        logs: "",
        deploymentId: null,
        startedAt: now,
      })
      .run();

    activeAgentProjects.add(projectId);

    const applied = applyAgentDeploymentOutcome(sessionId, deploymentId);
    expect(applied).toBe(false);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();
    expect(activeAgentProjects.has(projectId)).toBe(true);
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
