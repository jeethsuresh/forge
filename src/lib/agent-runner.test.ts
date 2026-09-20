import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentContainers, agentEvents, agentSessions, projects } from "@/lib/db/schema";
import { AGENT_WALL_CLOCK_MS } from "@/lib/agent-heartbeat";
import {
  activeAgentContainers,
  getAgentSessionForClient,
  listAgentSessionsForClient,
  reconcileStuckAgentSession,
} from "@/lib/agent-runner";

describe("reconcileStuckAgentSession", () => {
  let projectId: string;
  let sessionId: string;

  afterEach(() => {
    activeAgentContainers.delete(sessionId);
    db.delete(agentContainers).where(eq(agentContainers.sessionId, sessionId)).run();
    db.delete(agentEvents).where(eq(agentEvents.sessionId, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  function seedRunningTurn() {
    projectId = randomUUID();
    sessionId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "iam-server",
        githubRepo: "acme/iam",
        branch: "main",
        clonePath: "/tmp/iam",
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
        initialPrompt: "Create a Forgefile",
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
        payload: JSON.stringify({ type: "user", text: "Create a Forgefile" }),
        createdAt: now,
      })
      .run();
    return now;
  }

  it("does not mark a live turn failed when the in-memory Set is empty", () => {
    const now = seedRunningTurn();
    db.insert(agentContainers)
      .values({
        sessionId,
        containerId: "cid-live",
        image: "forge-agent:latest",
        status: "running",
        lastHeartbeatAt: now,
        lastActivityAt: now,
        startedAt: now,
        deadlineAt: new Date(now.getTime() + AGENT_WALL_CLOCK_MS),
        killReason: null,
      })
      .run();

    const session = getAgentSessionForClient(sessionId);
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();
    expect(session?.errorMessage ?? "").not.toMatch(/ended unexpectedly/i);
  });

  it("does not fail an incomplete turn after the per-turn container is removed", () => {
    seedRunningTurn();
    const session = reconcileStuckAgentSession(sessionId);
    expect(session?.status).toBe("running");
    expect(session?.errorMessage).toBeNull();

    const listed = listAgentSessionsForClient(projectId);
    expect(listed[0]?.status).toBe("running");
    expect(listed[0]?.errorMessage).toBeNull();
  });
});

describe("joinOrRunAgentTurn", () => {
  it("joins a second caller onto the in-flight turn instead of starting another", async () => {
    const { joinOrRunAgentTurn } = await import("@/lib/agent-runner");
    let runs = 0;
    const sessionId = randomUUID();
    const run = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
    };

    const [a, b] = await Promise.all([
      joinOrRunAgentTurn(sessionId, run),
      joinOrRunAgentTurn(sessionId, run),
    ]);

    expect(runs).toBe(1);
    expect(a).toBe("ran");
    expect(b).toBe("joined");
  });
});

describe("reactivateFailedSession", () => {
  it("clears a leftover reconcile_missing killReason so retry is not failed immediately", async () => {
    const { reactivateFailedSession } = await import("@/lib/agent-runner");
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "retry",
        githubRepo: "acme/retry",
        branch: "main",
        clonePath: "/tmp/retry",
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
        status: "failed",
        initialPrompt: "fix",
        logs: "",
        startedAt: now,
        completedAt: now,
        errorMessage: "Agent container stopped (reconcile_missing)",
      })
      .run();
    db.insert(agentContainers)
      .values({
        sessionId,
        containerId: "old",
        image: "forge-agent:latest",
        status: "removed",
        startedAt: now,
        deadlineAt: new Date(now.getTime() + AGENT_WALL_CLOCK_MS),
        killReason: "reconcile_missing",
      })
      .run();

    reactivateFailedSession(sessionId);

    const container = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(container?.killReason).toBeNull();

    db.delete(agentContainers).where(eq(agentContainers.sessionId, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });
});
