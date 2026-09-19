import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentContainers, agentSessions, projects } from "@/lib/db/schema";
import {
  agentContainerName,
  assertNoDockerSockMount,
  buildAgentContainerRunArgs,
  mountArgTargetsDockerSock,
  resolveHostBindPath,
  setAgentContainerDockerRunner,
  startAgentContainer,
  stopAgentContainer,
  removeAgentContainer,
  waitForAgentContainerExit,
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
  let previousContainerName: string | undefined;

  beforeEach(() => {
    previousContainerName = process.env.FORGE_CONTAINER_NAME;
  });

  afterEach(() => {
    setAgentContainerDockerRunner(null);
    if (previousContainerName === undefined) {
      delete process.env.FORGE_CONTAINER_NAME;
    } else {
      process.env.FORGE_CONTAINER_NAME = previousContainerName;
    }
  });

  it("rewrites /data workspace binds to the host volume source", async () => {
    process.env.FORGE_CONTAINER_NAME = "forge_app_1";
    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "inspect" && args[1] === "forge_app_1") {
        return {
          stdout: JSON.stringify([
            {
              Mounts: [
                {
                  Type: "volume",
                  Source:
                    "/home/jeeth/.local/share/containers/storage/volumes/forge_forge-data/_data",
                  Destination: "/data",
                },
              ],
            },
          ]),
          stderr: "",
        };
      }
      throw new Error(`unexpected docker args: ${args.join(" ")}`);
    });

    expect(
      await resolveHostBindPath("/data/repos/shatterfield-main"),
    ).toBe(
      "/home/jeeth/.local/share/containers/storage/volumes/forge_forge-data/_data/repos/shatterfield-main",
    );
  });

  it("leaves host paths unchanged when they are not under a container mount", async () => {
    process.env.FORGE_CONTAINER_NAME = "forge_app_1";
    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "inspect") {
        return {
          stdout: JSON.stringify([
            {
              Mounts: [
                {
                  Source: "/host/vol/_data",
                  Destination: "/data",
                },
              ],
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    expect(await resolveHostBindPath("/tmp/agent-lifecycle")).toBe(
      "/tmp/agent-lifecycle",
    );
  });

  it("startAgentContainer bind-mounts the host path for /data clones", async () => {
    process.env.FORGE_CONTAINER_NAME = "forge_app_1";
    const { projectId, sessionId } = seedSession();
    const seen: string[][] = [];

    setAgentContainerDockerRunner(async (args) => {
      seen.push([...args]);
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
      if (args[0] === "inspect") {
        return {
          stdout: JSON.stringify([
            {
              Mounts: [
                {
                  Source: "/host/forge-data/_data",
                  Destination: "/data",
                },
              ],
            },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "run") return { stdout: "cidhostbind\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await startAgentContainer({
      sessionId,
      projectId,
      branch: "agent/feat",
      cloneUrl: "https://github.com/owner/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
      workspaceBind: "/data/repos/shatterfield-main",
    });

    const runArgs = seen.find((a) => a[0] === "run");
    expect(runArgs).toContain(
      "/host/forge-data/_data/repos/shatterfield-main:/workspace/repo:z",
    );
    expect(runArgs?.some((a) => a.startsWith("/data/repos/"))).toBe(false);
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
    expect(args).toContain("--user");
    expect(args).toContain("0:0");
    expect(args.some((a) => a.includes("docker.sock"))).toBe(false);
    expect(args.some((a) => a.includes("podman.sock"))).toBe(false);
    expect(() => assertNoDockerSockMount(args)).not.toThrow();
  });

  it("passes FORGE_CURSOR_SESSION_ID when resuming a Cursor session", () => {
    const args = buildAgentContainerRunArgs({
      sessionId: "sess-1",
      projectId: "proj-1",
      branch: "main",
      cloneUrl: "https://git.example/acme.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.sess-1.token",
      cursorSessionId: "cursor-abc",
    });
    expect(
      args.some((a) => a.includes("FORGE_CURSOR_SESSION_ID=cursor-abc")),
    ).toBe(true);
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

  it("reuses a running container with the same name instead of docker rm -f", async () => {
    const { sessionId, projectId } = seedSession();
    const name = agentContainerName(sessionId);
    const seen: string[][] = [];

    setAgentContainerDockerRunner(async (args) => {
      seen.push([...args]);
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
      if (args[0] === "inspect" && args.includes("-f")) {
        return { stdout: "livecid123 true 0\n", stderr: "" };
      }
      if (args[0] === "rm") {
        throw new Error("docker rm -f on a running agent sends SIGTERM (exit 143)");
      }
      if (args[0] === "run") {
        throw new Error("should not docker run while the session container is live");
      }
      return { stdout: "", stderr: "" };
    });

    const result = await startAgentContainer({
      sessionId,
      projectId,
      branch: "agent/feat",
      cloneUrl: "https://github.com/owner/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
    });

    expect(result.containerId).toBe("livecid123");
    expect(seen.some((a) => a[0] === "rm")).toBe(false);
    expect(seen.some((a) => a[0] === "run")).toBe(false);
    expect(seen.some((a) => a[0] === "inspect" && a.includes(name))).toBe(true);
    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.containerId).toBe("livecid123");
    expect(row?.status).toBe("running");
  });

  it("removes a leftover stopped container with the same name before docker run", async () => {
    const { sessionId, projectId } = seedSession();
    const name = agentContainerName(sessionId);
    const seen: string[][] = [];

    setAgentContainerDockerRunner(async (args) => {
      seen.push([...args]);
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
      if (args[0] === "inspect" && args.includes("-f")) {
        return { stdout: "oldcid false 143\n", stderr: "" };
      }
      if (args[0] === "rm") return { stdout: "", stderr: "" };
      if (args[0] === "run") {
        if (!seen.some((a) => a[0] === "rm" && a.includes(name))) {
          throw new Error(
            `the container name "${name}" is already in use by 0137aaa`,
          );
        }
        return { stdout: "cid-reused\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await startAgentContainer({
      sessionId,
      projectId,
      branch: "agent/feat",
      cloneUrl: "https://github.com/owner/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
    });

    expect(result.containerId).toBe("cid-reused");
    const rm = seen.find((a) => a[0] === "rm");
    expect(rm).toEqual(["rm", "-f", name]);
    const rmAt = seen.findIndex((a) => a[0] === "rm");
    const runAt = seen.findIndex((a) => a[0] === "run");
    expect(rmAt).toBeGreaterThanOrEqual(0);
    expect(runAt).toBeGreaterThan(rmAt);
  });

  it("joins concurrent startAgentContainer calls so only one docker run happens", async () => {
    const { sessionId, projectId } = seedSession();
    let runs = 0;
    let inspectAfterRun = false;

    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
      if (args[0] === "inspect" && args.includes("-f")) {
        if (inspectAfterRun) return { stdout: "cid-once true 0\n", stderr: "" };
        throw new Error("Error: no such container");
      }
      if (args[0] === "rm") return { stdout: "", stderr: "" };
      if (args[0] === "run") {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        inspectAfterRun = true;
        return { stdout: "cid-once\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const opts = {
      sessionId,
      projectId,
      branch: "agent/feat",
      cloneUrl: "https://github.com/owner/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
    };
    const [a, b] = await Promise.all([
      startAgentContainer(opts),
      startAgentContainer(opts),
    ]);

    expect(runs).toBe(1);
    expect(a.containerId).toBe("cid-once");
    expect(b.containerId).toBe("cid-once");
  });

  it("does not leak agent env secrets when docker run fails", async () => {
    const { sessionId, projectId } = seedSession();
    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
      if (args[0] === "rm") return { stdout: "", stderr: "" };
      throw new Error(
        `Command failed: docker run -d --name x -e FORGE_OPS_API_TOKEN=fos.secret.token -e CURSOR_API_KEY=crsr_secret forge-agent:latest`,
      );
    });

    await expect(
      startAgentContainer({
        sessionId,
        projectId,
        branch: "agent/feat",
        cloneUrl: "https://github.com/owner/repo.git",
        opsBaseUrl: "http://127.0.0.1:3456",
        opsToken: "fos.test.token",
        cursorApiKey: "crsr_secret",
      }),
    ).rejects.toThrow(/Failed to start agent container/);

    try {
      await startAgentContainer({
        sessionId,
        projectId,
        branch: "agent/feat",
        cloneUrl: "https://github.com/owner/repo.git",
        opsBaseUrl: "http://127.0.0.1:3456",
        opsToken: "fos.test.token",
        cursorApiKey: "crsr_secret",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toMatch(/fos\.secret/);
      expect(message).not.toMatch(/crsr_secret/);
      expect(message).not.toMatch(/FORGE_OPS_API_TOKEN=/);
      expect(message).not.toMatch(/CURSOR_API_KEY=/);
    }
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

    expect(commands).toEqual(["image", "inspect", "run", "stop", "rm"]);
    const row = db
      .select()
      .from(agentContainers)
      .where(eq(agentContainers.sessionId, sessionId))
      .get();
    expect(row?.status).toBe("removed");
  });

  it("does not treat a docker wait CLI failure as exit code 1 while the container is running", async () => {
    const { projectId, sessionId } = seedSession();
    db.insert(agentContainers)
      .values({
        sessionId,
        containerId: "cid-wait",
        image: "forge-agent:latest",
        status: "running",
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60_000),
      })
      .run();

    let waits = 0;
    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "wait") {
        waits += 1;
        if (waits === 1) throw new Error("wait: connection reset");
        return { stdout: "0\n", stderr: "" };
      }
      if (args[0] === "inspect") return { stdout: "true 0\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await expect(waitForAgentContainerExit(sessionId)).resolves.toBe(0);

    db.delete(agentContainers).where(eq(agentContainers.sessionId, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("keeps waiting after exit 143 when the session container is still running", async () => {
    const { projectId, sessionId } = seedSession();
    db.insert(agentContainers)
      .values({
        sessionId,
        containerId: "cid-old",
        image: "forge-agent:latest",
        status: "running",
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60_000),
      })
      .run();

    let waits = 0;
    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "wait") {
        waits += 1;
        if (waits === 1) return { stdout: "143\n", stderr: "" };
        return { stdout: "0\n", stderr: "" };
      }
      if (args[0] === "inspect" && args.includes("-f")) {
        return { stdout: "cid-new true 0\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    await expect(waitForAgentContainerExit(sessionId)).resolves.toBe(0);
    expect(waits).toBeGreaterThanOrEqual(2);

    db.delete(agentContainers).where(eq(agentContainers.sessionId, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });
});
