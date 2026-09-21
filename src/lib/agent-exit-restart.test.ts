import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import {
  MAX_AGENT_EXIT_RESTARTS,
  agentExitFailureMessage,
  isRecoverableAgentExit,
  isUnrecoverableKillReason,
} from "@/lib/agent-exit-restart";

describe("agent exit restart policy", () => {
  it("caps auto-restarts at 3", () => {
    expect(MAX_AGENT_EXIT_RESTARTS).toBe(3);
  });

  it("says how many restarts already ran when the turn finally fails", () => {
    expect(agentExitFailureMessage(1, 0)).toBe(
      "Agent container exited with code 1",
    );
    expect(agentExitFailureMessage(1, 3)).toBe(
      "Agent container exited with code 1 after 3 restart(s)",
    );
  });

  it("restarts a generic non-zero exit before the cap", () => {
    expect(
      isRecoverableAgentExit({ exitCode: 1, restartCount: 0 }),
    ).toBe(true);
    expect(
      isRecoverableAgentExit({ exitCode: 128, restartCount: 2 }),
    ).toBe(true);
    expect(
      isRecoverableAgentExit({ exitCode: 143, restartCount: 0 }),
    ).toBe(true);
  });

  it("does not restart OOM 137 or policy kills", () => {
    expect(
      isRecoverableAgentExit({ exitCode: 137, restartCount: 0 }),
    ).toBe(false);
    expect(
      isRecoverableAgentExit({
        exitCode: 1,
        killReason: "heartbeat_miss",
        restartCount: 0,
      }),
    ).toBe(false);
    expect(isUnrecoverableKillReason("user_stop")).toBe(true);
    expect(isUnrecoverableKillReason("idle_timeout")).toBe(true);
    expect(isUnrecoverableKillReason("wall_clock")).toBe(true);
    expect(isUnrecoverableKillReason("branch_merged")).toBe(true);
    expect(isUnrecoverableKillReason("branch_deleted")).toBe(true);
    expect(isUnrecoverableKillReason("error")).toBe(false);
  });

  it("fails after three restarts and ignores exit 0", () => {
    expect(
      isRecoverableAgentExit({ exitCode: 1, restartCount: 3 }),
    ).toBe(false);
    expect(
      isRecoverableAgentExit({ exitCode: 0, restartCount: 0 }),
    ).toBe(false);
  });
});

describe("runAgentContainerWithRestart", () => {
  it("restarts a recoverable exit then succeeds", async () => {
    const { runAgentContainerWithRestart } = await import(
      "@/lib/agent-exit-restart"
    );
    const starts: number[] = [];
    const exits: number[] = [];
    const codes = [1, 0];
    const persisted: Array<{ count: number; code: number | null }> = [];

    const result = await runAgentContainerWithRestart({
      initialRestartCount: 0,
      start: async () => {
        starts.push(starts.length + 1);
      },
      waitForExit: async () => codes.shift() ?? 0,
      getKillReason: () => null,
      onExit: (info) => {
        exits.push(info.exitCode);
      },
      persistRestart: (restartCount, lastExitCode) => {
        persisted.push({ count: restartCount, code: lastExitCode });
      },
      remove: async () => {},
      isCancelled: () => false,
      isEnded: () => false,
      isStopping: () => false,
    });

    expect(starts).toEqual([1, 2]);
    expect(exits).toEqual([1]);
    expect(result).toEqual({ outcome: "success", exitCode: 0, restartCount: 0 });
    expect(persisted.at(-1)).toEqual({ count: 0, code: null });
  });

  it("fails immediately on OOM 137", async () => {
    const { runAgentContainerWithRestart } = await import(
      "@/lib/agent-exit-restart"
    );
    const starts: number[] = [];
    const result = await runAgentContainerWithRestart({
      initialRestartCount: 0,
      start: async () => {
        starts.push(1);
      },
      waitForExit: async () => 137,
      getKillReason: () => null,
      onExit: () => {},
      persistRestart: () => {},
      remove: async () => {},
      isCancelled: () => false,
      isEnded: () => false,
      isStopping: () => false,
    });
    expect(starts).toHaveLength(1);
    expect(result.outcome).toBe("fail");
    expect(result.exitCode).toBe(137);
  });

  it("fails after three recoverable restarts", async () => {
    const { runAgentContainerWithRestart, MAX_AGENT_EXIT_RESTARTS } =
      await import("@/lib/agent-exit-restart");
    let starts = 0;
    const result = await runAgentContainerWithRestart({
      initialRestartCount: 0,
      start: async () => {
        starts += 1;
      },
      waitForExit: async () => 1,
      getKillReason: () => null,
      onExit: () => {},
      persistRestart: () => {},
      remove: async () => {},
      isCancelled: () => false,
      isEnded: () => false,
      isStopping: () => false,
    });
    expect(starts).toBe(MAX_AGENT_EXIT_RESTARTS + 1);
    expect(result.outcome).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.restartCount).toBe(MAX_AGENT_EXIT_RESTARTS);
  });
});

describe("agent_sessions restart columns", () => {
  it("defaults restartCount to 0", () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "restart-schema",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/restart-schema",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/x",
        status: "running",
        initialPrompt: "go",
        logs: "",
        startedAt: now,
      })
      .run();
    const row = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(row?.restartCount).toBe(0);
    expect(row?.lastExitCode).toBeNull();
    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });
});
