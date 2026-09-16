import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import {
  isOperatorStopError,
  operatorStopError,
  shouldFailStoppedContainer,
  transition,
} from "@/lib/agent-session-machine";

describe("shouldFailStoppedContainer", () => {
  it("does not fail deploying when the container was removed without killReason", () => {
    expect(
      shouldFailStoppedContainer({
        sessionStatus: "deploying",
        containerStatus: "removed",
        killReason: null,
        turnIncomplete: false,
      }),
    ).toBe(false);
  });

  it("does not fail a completed turn whose container is already stopped", () => {
    expect(
      shouldFailStoppedContainer({
        sessionStatus: "running",
        containerStatus: "stopped",
        killReason: null,
        turnIncomplete: false,
      }),
    ).toBe(false);
  });

  it("fails incomplete running turns and killReason stops", () => {
    expect(
      shouldFailStoppedContainer({
        sessionStatus: "running",
        containerStatus: "stopped",
        killReason: null,
        turnIncomplete: true,
      }),
    ).toBe(true);
    expect(
      shouldFailStoppedContainer({
        sessionStatus: "deploying",
        containerStatus: "stopped",
        killReason: "heartbeat_miss",
        turnIncomplete: false,
      }),
    ).toBe(true);
  });
});

describe("transition", () => {
  it("writes operator_stop reasons onto failed/completed rows", () => {
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "machine",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/machine",
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

    transition(sessionId, { type: "operator_stop", reason: "stop" });
    const row = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toBe(operatorStopError("stop"));
    expect(isOperatorStopError(row?.errorMessage)).toBe(true);

    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });
});
