import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentContainers, agentSessions, projects } from "@/lib/db/schema";
import {
  assertNoDockerSockMount,
  buildAgentContainerRunArgs,
  mountArgTargetsDockerSock,
  setAgentContainerDockerRunner,
  startAgentContainer,
  stopAgentContainer,
  removeAgentContainer,
} from "@/lib/agent-container";

function seedSession(): { projectId: string; sessionId: string } {
  const projectId = randomUUID();
  const sessionId = randomUUID();
  db.insert(projects)
    .values({
      id: projectId,
      name: "Agent Lifecycle",
      githubRepo: "owner/agent-lifecycle",
      branch: "main",
      clonePath: "/tmp/agent-lifecycle",
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
      branch: "agent/feat",
      status: "running",
      initialPrompt: "hi",
      source: "manual",
      logs: "",
      startedAt: new Date(),
    })
    .run();
  return { projectId, sessionId };
}

describe("agent container lifecycle", () => {
  afterEach(() => {
    setAgentContainerDockerRunner(null);
  });

  it("detects docker.sock mount targets", () => {
    expect(mountArgTargetsDockerSock("/var/run/docker.sock:/var/run/docker.sock")).toBe(
      true,
    );
    expect(mountArgTargetsDockerSock("/tmp/workspace:/workspace")).toBe(false);
  });

  it("buildAgentContainerRunArgs excludes docker.sock mounts", () => {
    const args = buildAgentContainerRunArgs({
      sessionId: "sess-1",
      projectId: "proj-1",
      branch: "main",
      cloneUrl: "https://github.com/owner/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.sess-1.token",
      gitUsername: "git",
      gitPassword: "secret",
      heartbeatIntervalSec: 10,
    });

    expect(args[0]).toBe("run");
    expect(args).toContain("-e");
    expect(args.some((a) => a.includes("FORGE_OPS_API_TOKEN=fos.sess-1.token"))).toBe(
      true,
    );
    expect(args.some((a) => a.includes("FORGE_OPS_API_BASE=http://127.0.0.1:3456"))).toBe(
      true,
    );
    expect(args.some((a) => a.includes("FORGE_AGENT_HEARTBEAT_INTERVAL_SEC=10"))).toBe(
      true,
    );
    expect(args.some((a) => a.includes("docker.sock"))).toBe(false);
    expect(args.some((a) => a.includes("podman.sock"))).toBe(false);
    expect(() => assertNoDockerSockMount(args)).not.toThrow();
  });

  it("assertNoDockerSockMount rejects sock binds", () => {
    expect(() =>
      assertNoDockerSockMount([
        "run",
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "forge-agent:latest",
      ]),
    ).toThrow(/docker\.sock|runtime socket/i);
  });

  it("startAgentContainer uses runner and records row without sock mount", async () => {
    const { projectId, sessionId } = seedSession();
    const seen: string[][] = [];

    setAgentContainerDockerRunner(async (args) => {
      seen.push([...args]);
      assertNoDockerSockMount(args);
      return { stdout: "ciddeadbeef\n", stderr: "" };
    });

    const result = await startAgentContainer({
      sessionId,
      projectId,
      branch: "agent/feat",
      cloneUrl: "https://github.com/owner/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
    });

    expect(result.containerId).toBe("ciddeadbeef");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.some((a) => a.includes("docker.sock"))).toBe(false);

    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.containerId).toBe("ciddeadbeef");
    expect(row?.status).toBe("running");
    expect(row?.killReason).toBeNull();
  });

  it("stop and remove update status via runner", async () => {
    const { projectId, sessionId } = seedSession();
    const commands: string[] = [];

    setAgentContainerDockerRunner(async (args) => {
      commands.push(args[0] ?? "");
      if (args[0] === "run") return { stdout: "cid123\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await startAgentContainer({
      sessionId,
      projectId,
      branch: "agent/feat",
      cloneUrl: "https://github.com/owner/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
    });
    await stopAgentContainer(sessionId);
    await removeAgentContainer(sessionId);

    expect(commands).toEqual(["run", "stop", "rm"]);
    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.status).toBe("removed");
  });
});
