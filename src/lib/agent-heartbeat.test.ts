import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentContainers,
  agentSessions,
  projects,
} from "@/lib/db/schema";
import { setAgentContainerDockerRunner } from "@/lib/agent-container";
import {
  AGENT_HEARTBEAT_INTERVAL_SEC,
  AGENT_HEARTBEAT_MISS_THRESHOLD,
  AGENT_IDLE_MS,
  AGENT_WALL_CLOCK_MS,
  agentHeartbeatMissWindowMs,
  evaluateAgentKillPolicy,
  recordAgentActivity,
  recordAgentHeartbeat,
  reasonForAgentKill,
} from "@/lib/agent-heartbeat";

function seedRunningContainer(overrides?: {
  lastHeartbeatAt?: Date;
  lastActivityAt?: Date;
  startedAt?: Date;
  deadlineAt?: Date;
}): { projectId: string; sessionId: string } {
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const startedAt = overrides?.startedAt ?? new Date();
  const deadlineAt =
    overrides?.deadlineAt ??
    new Date(startedAt.getTime() + AGENT_WALL_CLOCK_MS);

  db.insert(projects)
    .values({
      id: projectId,
      name: "HB Kill",
      githubRepo: "owner/hb-kill",
      branch: "main",
      clonePath: "/tmp/hb-kill",
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
      branch: "agent/hb",
      status: "running",
      initialPrompt: "test",
      source: "manual",
      logs: "",
      startedAt,
    })
    .run();
  db.insert(agentContainers)
    .values({
      sessionId,
      containerId: `cid-${sessionId.slice(0, 8)}`,
      image: "forge-agent:latest",
      status: "running",
      lastHeartbeatAt: overrides?.lastHeartbeatAt ?? startedAt,
      lastActivityAt: overrides?.lastActivityAt ?? startedAt,
      startedAt,
      deadlineAt,
      killReason: null,
    })
    .run();

  return { projectId, sessionId };
}

describe("agent heartbeat kill policy", () => {
  afterEach(() => {
    setAgentContainerDockerRunner(null);
  });

  it("exports spec defaults", () => {
    expect(AGENT_HEARTBEAT_INTERVAL_SEC).toBe(10);
    expect(AGENT_HEARTBEAT_MISS_THRESHOLD).toBe(3);
    expect(AGENT_IDLE_MS).toBe(30 * 60 * 1000);
    expect(AGENT_WALL_CLOCK_MS).toBe(2 * 60 * 60 * 1000);
    expect(agentHeartbeatMissWindowMs()).toBe(30_000);
  });

  it("reasonForAgentKill detects heartbeat miss, idle, and wall-clock", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const base = {
      lastHeartbeatAt: startedAt,
      lastActivityAt: startedAt,
      startedAt,
      deadlineAt: new Date(startedAt.getTime() + AGENT_WALL_CLOCK_MS),
    };

    expect(
      reasonForAgentKill(base, new Date(startedAt.getTime() + 29_000)),
    ).toBeNull();

    expect(
      reasonForAgentKill(base, new Date(startedAt.getTime() + 30_000)),
    ).toBe("heartbeat_miss");

    expect(
      reasonForAgentKill(
        { ...base, lastHeartbeatAt: new Date(startedAt.getTime() + AGENT_IDLE_MS) },
        new Date(startedAt.getTime() + AGENT_IDLE_MS),
      ),
    ).toBe("idle_timeout");

    expect(
      reasonForAgentKill(
        {
          ...base,
          lastHeartbeatAt: new Date(startedAt.getTime() + AGENT_WALL_CLOCK_MS),
          lastActivityAt: new Date(startedAt.getTime() + AGENT_WALL_CLOCK_MS),
        },
        new Date(startedAt.getTime() + AGENT_WALL_CLOCK_MS),
      ),
    ).toBe("wall_clock");
  });

  it("recordAgentHeartbeat and recordAgentActivity update timestamps", () => {
    const { sessionId } = seedRunningContainer({
      lastHeartbeatAt: new Date("2026-01-01T00:00:00.000Z"),
      lastActivityAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const now = new Date("2026-01-01T00:05:00.000Z");
    recordAgentHeartbeat(sessionId, now);
    let row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.lastHeartbeatAt?.getTime()).toBeGreaterThanOrEqual(
      now.getTime() - 2000,
    );

    const later = new Date("2026-01-01T00:10:00.000Z");
    recordAgentActivity(sessionId, later);
    row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.lastActivityAt?.getTime()).toBeGreaterThanOrEqual(
      later.getTime() - 2000,
    );
  });

  it("evaluateAgentKillPolicy fails session on heartbeat miss", async () => {
    const startedAt = new Date(Date.now() - 60_000);
    const { sessionId } = seedRunningContainer({
      startedAt,
      lastHeartbeatAt: startedAt,
      lastActivityAt: new Date(),
      deadlineAt: new Date(Date.now() + AGENT_WALL_CLOCK_MS),
    });

    setAgentContainerDockerRunner(async () => ({ stdout: "", stderr: "" }));

    const verdicts = await evaluateAgentKillPolicy(new Date());
    expect(verdicts.some((v) => v.sessionId === sessionId && v.reason === "heartbeat_miss")).toBe(
      true,
    );

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("failed");
    expect(session?.errorMessage).toMatch(/heartbeat/i);

    const container = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(container?.killReason).toBe("heartbeat_miss");
  });

  it("evaluateAgentKillPolicy fails session on idle timeout", async () => {
    const startedAt = new Date(Date.now() - AGENT_IDLE_MS - 5_000);
    const { sessionId } = seedRunningContainer({
      startedAt,
      lastHeartbeatAt: new Date(),
      lastActivityAt: startedAt,
      deadlineAt: new Date(Date.now() + AGENT_WALL_CLOCK_MS),
    });

    setAgentContainerDockerRunner(async () => ({ stdout: "", stderr: "" }));

    const verdicts = await evaluateAgentKillPolicy(new Date());
    expect(verdicts.some((v) => v.sessionId === sessionId && v.reason === "idle_timeout")).toBe(
      true,
    );

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("failed");
    expect(session?.errorMessage).toMatch(/idle/i);
  });

  it("evaluateAgentKillPolicy fails session on wall-clock max", async () => {
    const startedAt = new Date(Date.now() - AGENT_WALL_CLOCK_MS - 1_000);
    const { sessionId } = seedRunningContainer({
      startedAt,
      lastHeartbeatAt: new Date(),
      lastActivityAt: new Date(),
      deadlineAt: new Date(Date.now() - 1_000),
    });

    setAgentContainerDockerRunner(async () => ({ stdout: "", stderr: "" }));

    const verdicts = await evaluateAgentKillPolicy(new Date());
    expect(verdicts.some((v) => v.sessionId === sessionId && v.reason === "wall_clock")).toBe(
      true,
    );

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("failed");
    expect(session?.errorMessage).toMatch(/wall-clock/i);
  });
});
