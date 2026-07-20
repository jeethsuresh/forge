import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentEvents,
  agentSessions,
  deployments,
  forgeUpdates,
  projects,
} from "@/lib/db/schema";
import {
  activeAgentProjects,
  applyAgentDeploymentOutcome,
  reconcileProjectAgentSessions,
} from "@/lib/agent-state";
import { FORGE_UPDATE_SUCCESS_MARKER } from "@/lib/self-update-helpers";

describe("deploy-agent-resilience integration (Layer A)", () => {
  let projectId: string;
  let sessionId: string;
  let sourceDir: string;
  let previousSourceDir: string | undefined;
  let previousSelfRepo: string | undefined;

  beforeEach(() => {
    projectId = randomUUID();
    sessionId = randomUUID();
    sourceDir = mkdtempSync(join(tmpdir(), "forge-resilience-"));
    previousSourceDir = process.env.FORGE_SOURCE_DIR;
    previousSelfRepo = process.env.FORGE_SELF_REPO;
    process.env.FORGE_SOURCE_DIR = sourceDir;
    process.env.FORGE_SELF_REPO = "acme/forge";

    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Orchestrator",
        githubRepo: "acme/forge",
        branch: "main",
        clonePath: sourceDir,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  afterEach(() => {
    activeAgentProjects.delete(projectId);
    vi.restoreAllMocks();
    vi.resetModules();
    db.delete(agentEvents).where(eq(agentEvents.sessionId, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(deployments).where(eq(deployments.projectId, projectId)).run();
    db.delete(forgeUpdates).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    rmSync(sourceDir, { recursive: true, force: true });
    if (previousSourceDir === undefined) delete process.env.FORGE_SOURCE_DIR;
    else process.env.FORGE_SOURCE_DIR = previousSourceDir;
    if (previousSelfRepo === undefined) delete process.env.FORGE_SELF_REPO;
    else process.env.FORGE_SELF_REPO = previousSelfRepo;
    delete process.env.DOCKER_HOST;
    delete process.env.FORGE_PODMAN_API_PORT;
  });

  it("ensureDockerDaemon rejects dead DOCKER_HOST with actionable message", async () => {
    process.env.DOCKER_HOST = "tcp://127.0.0.1:19999";
    process.env.FORGE_PODMAN_API_PORT = "19999";
    delete process.env.FORGE_DOCKER_USE_SOCKET;
    vi.resetModules();
    vi.doMock("child_process", async () => {
      const actual = await vi.importActual<typeof import("child_process")>(
        "child_process",
      );
      return {
        ...actual,
        execFileSync: vi.fn(() => {
          throw new Error("connection refused");
        }),
        execFile: vi.fn(
          (
            _file: string,
            _args: string[],
            _opts: unknown,
            cb?: (err: Error | null, stdout: string, stderr: string) => void,
          ) => {
            cb?.(new Error("connection refused"), "", "");
            return {} as never;
          },
        ),
      };
    });

    const { ensureDockerDaemon } = await import("@/lib/docker-runtime");
    await expect(ensureDockerDaemon()).rejects.toThrow(
      /Cannot connect to container runtime/,
    );
  });

  it("throws FETCH_HEAD message when .git stays unwritable after repair", async () => {
    const gitDir = join(sourceDir, ".git");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    // Make .git unwritable for the current process (probe + post-repair check).
    const { chmodSync } = await import("fs");
    chmodSync(gitDir, 0o555);

    vi.resetModules();
    vi.doMock("@/lib/docker-runtime", () => ({
      dockerExecEnv: () => process.env,
      ensureDockerDaemon: vi.fn().mockResolvedValue(undefined),
      forgeDataVolumeName: () => "forge_forge-data",
    }));
    vi.doMock("child_process", async () => {
      const actual = await vi.importActual<typeof import("child_process")>(
        "child_process",
      );
      return {
        ...actual,
        execFile: (
          _file: string,
          _args: string[],
          _opts: unknown,
          cb?: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          cb?.(null, "", "");
          return {} as never;
        },
      };
    });

    const { ensureForgeSourceWritableForAgents } = await import(
      "@/lib/forge-source-permissions"
    );
    await expect(ensureForgeSourceWritableForAgents()).rejects.toThrow(
      /FETCH_HEAD/,
    );
    chmodSync(gitDir, 0o755);
  });

  it("does not mark completed turns interrupted after simulated restart", () => {
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "agent/main",
        status: "running",
        initialPrompt: "work",
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
        payload: JSON.stringify({ type: "user", text: "work" }),
        createdAt: now,
      })
      .run();
    db.insert(agentEvents)
      .values({
        id: randomUUID(),
        sessionId,
        seq: 2,
        eventType: "result",
        payload: JSON.stringify({ type: "result", subtype: "success" }),
        createdAt: now,
      })
      .run();

    activeAgentProjects.delete(projectId);
    reconcileProjectAgentSessions(projectId);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("completed");
    expect(session?.errorMessage ?? "").not.toMatch(/interrupted/i);
  });

  it("finalizes deploying session from successful forge update id", () => {
    const updateId = randomUUID();
    const now = new Date();
    db.insert(forgeUpdates)
      .values({
        id: updateId,
        status: "success",
        trigger: "manual",
        logs: FORGE_UPDATE_SUCCESS_MARKER,
        targetCommitSha: "abc1234",
        startedAt: now,
        completedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "deploying",
        initialPrompt: "ship",
        logs: "",
        deploymentId: updateId,
        startedAt: now,
      })
      .run();

    activeAgentProjects.delete(projectId);
    expect(applyAgentDeploymentOutcome(sessionId, updateId)).toBe(true);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("completed");
    expect(session?.errorMessage).toBeNull();
  });

  it("agent-runner routes forge projects through startForgeUpdate", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/agent-runner.ts"),
      "utf8",
    );
    expect(source).toMatch(/isForgeProjectId\(projectId\)/);
    expect(source).toMatch(/startForgeUpdate\(\{ branch \}\)/);
    expect(source).toMatch(/Forge self-update/);
  });

  it("self-update reconcile heals success-marker rows (source invariant)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/self-update.ts"),
      "utf8",
    );
    expect(source).toMatch(/FORGE_UPDATE_SUCCESS_MARKER/);
    expect(source).toMatch(/status: "success"/);
  });
});
