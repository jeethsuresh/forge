import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentContainers, agentSessions, projects } from "@/lib/db/schema";
import {
  assertNoDockerSockMount,
  setAgentContainerDockerRunner,
} from "@/lib/agent-container";
import { agentRuntimeMode, isAgentProcessRunning } from "@/lib/agent-runner";

describe("agent-runner container runtime", () => {
  afterEach(() => {
    setAgentContainerDockerRunner(null);
    delete process.env.FORGE_AGENT_RUNTIME;
  });

  it("defaults to container runtime", () => {
    delete process.env.FORGE_AGENT_RUNTIME;
    expect(agentRuntimeMode()).toBe("container");
  });

  it("allows process runtime only when explicitly requested", () => {
    process.env.FORGE_AGENT_RUNTIME = "process";
    expect(agentRuntimeMode()).toBe("process");
  });

  it("startAgentContainer path records container without docker.sock", async () => {
    const { startAgentContainer } = await import("@/lib/agent-container");
    const projectId = randomUUID();
    const sessionId = randomUUID();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Runner Container",
        githubRepo: "owner/runner-container",
        branch: "main",
        clonePath: "/tmp/runner-container",
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
        branch: "agent/x",
        status: "running",
        initialPrompt: "go",
        source: "manual",
        logs: "",
        startedAt: new Date(),
      })
      .run();

    const seen: string[][] = [];
    setAgentContainerDockerRunner(async (args) => {
      seen.push([...args]);
      assertNoDockerSockMount(args);
      if (args[0] === "run") return { stdout: "containercid\n", stderr: "" };
      if (args[0] === "wait") return { stdout: "0\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    const result = await startAgentContainer({
      sessionId,
      projectId,
      branch: "agent/x",
      cloneUrl: "https://github.com/owner/runner-container.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
    });

    expect(result.containerId).toBe("containercid");
    expect(seen[0]?.[0]).toBe("run");
    expect(seen[0]?.some((a) => a.includes("docker.sock"))).toBe(false);

    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.containerId).toBe("containercid");
    expect(isAgentProcessRunning(sessionId)).toBe(false);
  });
});
