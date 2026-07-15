import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import { activeAgentProjects } from "@/lib/agent-state";
import {
  countQueuedAgentSessions,
  getNextQueuedAgentSession,
  markAgentSessionQueued,
  processAgentQueue,
} from "@/lib/agent-queue";

describe("agent-queue", () => {
  let projectId: string;

  beforeEach(() => {
    projectId = randomUUID();
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

  it("returns queued sessions in FIFO order", () => {
    const now = new Date();
    const firstId = randomUUID();
    const secondId = randomUUID();

    db.insert(agentSessions)
      .values([
        {
          id: firstId,
          projectId,
          branch: "agent/a",
          status: "queued",
          initialPrompt: "first",
          logs: "",
          startedAt: new Date(now.getTime() - 1000),
        },
        {
          id: secondId,
          projectId,
          branch: "agent/b",
          status: "queued",
          initialPrompt: "second",
          logs: "",
          startedAt: now,
        },
      ])
      .run();

    expect(countQueuedAgentSessions(projectId)).toBe(2);
    expect(getNextQueuedAgentSession(projectId)?.id).toBe(firstId);
  });

  it("starts the next queued session when the pipeline is idle", () => {
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/a",
        status: "queued",
        initialPrompt: "queued task",
        logs: "",
        startedAt: now,
      })
      .run();

    const startTurn = vi.fn();
    processAgentQueue(projectId, startTurn);

    expect(startTurn).toHaveBeenCalledWith(sessionId, projectId, "queued task");
    expect(activeAgentProjects.has(projectId)).toBe(true);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("pending");
  });

  it("does not start queued sessions while another agent is active", () => {
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/a",
        status: "queued",
        initialPrompt: "queued task",
        logs: "",
        startedAt: now,
      })
      .run();

    activeAgentProjects.add(projectId);
    const startTurn = vi.fn();
    processAgentQueue(projectId, startTurn);

    expect(startTurn).not.toHaveBeenCalled();
    expect(
      db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .get()?.status,
    ).toBe("queued");
  });

  it("updates an existing queued session prompt", () => {
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/a",
        status: "queued",
        initialPrompt: "old prompt",
        logs: "",
        startedAt: now,
      })
      .run();

    markAgentSessionQueued(sessionId, "new prompt");

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.initialPrompt).toBe("new prompt");
    expect(session?.status).toBe("queued");
  });
});
