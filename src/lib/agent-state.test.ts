import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentContainers,
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
import { AGENT_WALL_CLOCK_MS } from "@/lib/agent-heartbeat";

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
    db.delete(agentContainers).where(eq(agentContainers.sessionId, sessionId)).run();
    db.delete(agentEvents).where(eq(agentEvents.sessionId, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(deployments).where(eq(deployments.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("keeps incomplete running turns alive when the per-turn container is gone", () => {
    const now = new Date();
    const startedAt = new Date(now.getTime() - 10 * 60 * 1000);
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "running",
        initialPrompt: "do work",
        logs: "",
        startedAt,
      })
      .run();
    db.insert(agentEvents)
      .values({
        id: randomUUID(),
        sessionId,
        seq: 1,
        eventType: "user",
        payload: JSON.stringify({ type: "user", text: "do work" }),
        createdAt: startedAt,
      })
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(0);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(true);
    expect(getBlockingAgentSession(projectId)?.id).toBe(sessionId);
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

  it("keeps incomplete recovery turns running so a follow-up message can continue", () => {
    const now = new Date();
    const startedAt = new Date(now.getTime() - 10 * 60 * 1000);
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "running",
        source: "recovery",
        initialPrompt: "[deploy-recovery] fix deploy",
        logs: "",
        startedAt,
      })
      .run();
    db.insert(agentEvents)
      .values({
        id: randomUUID(),
        sessionId,
        seq: 1,
        eventType: "user",
        payload: JSON.stringify({ type: "user", text: "[deploy-recovery] fix" }),
        createdAt: startedAt,
      })
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(0);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(true);
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

  function insertLiveContainer(id: string, now: Date, status: "starting" | "running" = "running") {
    db.insert(agentContainers)
      .values({
        sessionId: id,
        containerId: `cid-${id.slice(0, 8)}`,
        image: "forge-agent:latest",
        status,
        lastHeartbeatAt: now,
        lastActivityAt: now,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + AGENT_WALL_CLOCK_MS),
        killReason: null,
      })
      .run();
  }

  it("does not interrupt an incomplete running turn with a live container when the in-memory set is empty", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/forgefile",
        status: "running",
        initialPrompt: "Create a forgefile",
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
        payload: JSON.stringify({ type: "user", text: "Create a forgefile" }),
        createdAt: now,
      })
      .run();
    insertLiveContainer(sessionId, now);

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(0);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(true);
    expect(getBlockingAgentSession(projectId)?.id).toBe(sessionId);
  });

  it("does not interrupt a recently started running turn that has no container row yet", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/starting",
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
    expect(count).toBe(0);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();
  });

  it("does not interrupt a pending session that started recently without a container row", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/pending",
        status: "pending",
        initialPrompt: "do work",
        logs: "",
        startedAt: now,
      })
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(0);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("pending");
    expect(session?.errorMessage).toBeNull();
  });

  it("does not fail a sibling just because its per-turn container is gone", () => {
    const now = new Date();
    const siblingId = randomUUID();
    const staleStart = new Date(now.getTime() - 10 * 60 * 1000);

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/live",
        status: "running",
        initialPrompt: "live turn",
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
        payload: JSON.stringify({ type: "user", text: "live turn" }),
        createdAt: now,
      })
      .run();
    insertLiveContainer(sessionId, now);

    db.insert(agentSessions)
      .values({
        id: siblingId,
        projectId,
        branch: "agent/orphan",
        status: "running",
        initialPrompt: "orphaned turn",
        logs: "",
        startedAt: staleStart,
      })
      .run();
    db.insert(agentEvents)
      .values({
        id: randomUUID(),
        sessionId: siblingId,
        seq: 1,
        eventType: "user",
        payload: JSON.stringify({ type: "user", text: "orphaned turn" }),
        createdAt: staleStart,
      })
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(0);

    const live = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    const sibling = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, siblingId))
      .get();
    expect(live?.status).toBe("running");
    expect(sibling?.status).toBe("running");
    expect(sibling?.errorMessage).toBeNull();
    expect(isAgentSessionActive(projectId)).toBe(true);

    db.delete(agentEvents).where(eq(agentEvents.sessionId, siblingId)).run();
    db.delete(agentSessions).where(eq(agentSessions.id, siblingId)).run();
  });

  it("does not fail incomplete running sessions whose turn container already stopped", () => {
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
    db.insert(agentContainers)
      .values({
        sessionId,
        containerId: "deadcid",
        image: "forge-agent:latest",
        status: "stopped",
        lastHeartbeatAt: now,
        lastActivityAt: now,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + AGENT_WALL_CLOCK_MS),
        killReason: null,
      })
      .run();

    const count = reconcileProjectAgentSessions(projectId);
    expect(count).toBe(0);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();
  });

  it("does not fail deploying sessions whose container was removed after a successful turn", () => {
    const now = new Date();
    const deploymentId = randomUUID();
    db.insert(deployments)
      .values({
        id: deploymentId,
        projectId,
        branch: "agent/test",
        status: "deploying",
        trigger: "agent",
        logs: "",
        startedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/test",
        status: "deploying",
        initialPrompt: "do work",
        logs: "",
        deploymentId,
        startedAt: now,
      })
      .run();
    db.insert(agentContainers)
      .values({
        sessionId,
        containerId: "removedcid",
        image: "forge-agent:latest",
        status: "removed",
        lastHeartbeatAt: now,
        lastActivityAt: now,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + AGENT_WALL_CLOCK_MS),
        killReason: null,
      })
      .run();

    reconcileProjectAgentSessions(projectId);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("deploying");
  });
});
