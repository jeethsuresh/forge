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
      workspaceBind: "/data/clones/proj",
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
    expect(args).toContain("/data/clones/proj:/workspace/repo:z");
    expect(args.some((a) => a.includes("docker.sock"))).toBe(false);
    expect(args.some((a) => a.includes("podman.sock"))).toBe(false);
    expect(() => assertNoDockerSockMount(args)).not.toThrow();
  });

  it("rejects workspace binds that look like docker.sock", () => {
    expect(() =>
      buildAgentContainerRunArgs({
        sessionId: "sess-1",
        projectId: "proj-1",
        branch: "main",
        cloneUrl: "https://github.com/owner/repo.git",
        opsBaseUrl: "http://127.0.0.1:3456",
        opsToken: "fos.x",
        workspaceBind: "/var/run/docker.sock",
      }),
    ).toThrow(/socket/i);
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

  it("ensureAgentImage inspects the image and skips build when present", async () => {
    const seen: string[][] = [];
    setAgentContainerDockerRunner(async (args) => {
      seen.push([...args]);
      if (args[0] === "image" && args[1] === "inspect") {
        return { stdout: "[]\n", stderr: "" };
      }
      throw new Error(`unexpected docker args: ${args.join(" ")}`);
    });

    const { ensureAgentImage } = await import("@/lib/agent-container");
    await ensureAgentImage("forge-agent:latest");
    expect(seen).toEqual([["image", "inspect", "forge-agent:latest"]]);
  });

  it("ensureAgentImage errors clearly when the image is missing", async () => {
    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "image" && args[1] === "inspect") {
        throw new Error("No such image");
      }
      return { stdout: "", stderr: "" };
    });

    const { ensureAgentImage } = await import("@/lib/agent-container");
    await expect(ensureAgentImage("forge-agent:latest")).rejects.toThrow(
      /forge-agent:latest.*build\.sh|Unable to find agent image/i,
    );
  });

  it("buildAgentContainerRunArgs mounts the host Cursor agent directory", () => {
    const prevFile = process.env.FORGE_HOST_MOUNTS_FILE;
    const prevAgent = process.env.FORGE_CURSOR_AGENT_DIR;
    process.env.FORGE_CURSOR_AGENT_DIR =
      "/home/test/.local/share/cursor-agent/versions/x";
    delete process.env.FORGE_HOST_MOUNTS_FILE;
    try {
      const args = buildAgentContainerRunArgs({
        sessionId: "sess-1",
        projectId: "proj-1",
        branch: "main",
        cloneUrl: "https://github.com/owner/repo.git",
        opsBaseUrl: "http://127.0.0.1:3456",
        opsToken: "fos.x",
      });
      expect(args).toContain(
        "/home/test/.local/share/cursor-agent/versions/x:/opt/cursor-agent:ro,z",
      );
      expect(
        args.some((a) => a.includes("FORGE_AGENT_BIN=/opt/cursor-agent/")),
      ).toBe(true);
    } finally {
      if (prevFile === undefined) delete process.env.FORGE_HOST_MOUNTS_FILE;
      else process.env.FORGE_HOST_MOUNTS_FILE = prevFile;
      if (prevAgent === undefined) delete process.env.FORGE_CURSOR_AGENT_DIR;
      else process.env.FORGE_CURSOR_AGENT_DIR = prevAgent;
    }
  });

  it("startAgentContainer uses runner and records row without sock mount", async () => {
    const { projectId, sessionId } = seedSession();
    const seen: string[][] = [];

    setAgentContainerDockerRunner(async (args) => {
      seen.push([...args]);
      assertNoDockerSockMount(args);
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
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
    expect(seen.some((a) => a[0] === "image" && a[1] === "inspect")).toBe(true);
    expect(seen.some((a) => a[0] === "run")).toBe(true);
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
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
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

    expect(commands).toEqual(["image", "run", "stop", "rm"]);
    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.status).toBe("removed");
  });
});
