/**
 * Layer A — agent container startup invariants.
 *
 * Guards regressions that surface as immediate agent failure or
 * "Agent process ended unexpectedly" (missing image, /data bind mounts,
 * branch not synced before session start).
 */
import { execFile } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentContainers, agentSessions, projects } from "@/lib/db/schema";
import {
  resolveHostBindPath,
  setAgentContainerDockerRunner,
  startAgentContainer,
} from "@/lib/agent-container";
import { projectRemoteUrl } from "@/lib/project-git-remote";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

describe("agent container startup integration (Layer A)", () => {
  const projectIds: string[] = [];
  let previousContainerName: string | undefined;

  beforeEach(() => {
    previousContainerName = process.env.FORGE_CONTAINER_NAME;
  });

  afterEach(async () => {
    setAgentContainerDockerRunner(null);
    if (previousContainerName === undefined) {
      delete process.env.FORGE_CONTAINER_NAME;
    } else {
      process.env.FORGE_CONTAINER_NAME = previousContainerName;
    }
    for (const id of projectIds) {
      db.delete(agentSessions).where(eq(agentSessions.projectId, id)).run();
      db.delete(projects).where(eq(projects.id, id)).run();
    }
    projectIds.length = 0;
  });

  it("build.sh builds forge-agent alongside forge-app", async () => {
    const { readFile } = await import("fs/promises");
    const buildSh = await readFile(join(process.cwd(), "build.sh"), "utf8");
    expect(buildSh).toMatch(/docker\/agent\/Dockerfile/);
    expect(buildSh).toMatch(/forge-agent:latest/);
  });

  it("startAgentContainer rewrites /data workspace binds before docker run", async () => {
    process.env.FORGE_CONTAINER_NAME = "forge_app_1";
    const projectId = randomUUID();
    const sessionId = randomUUID();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Bind Test",
        githubRepo: "owner/bind-test",
        branch: "main",
        clonePath: "/data/repos/shatterfield-main",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "running",
        initialPrompt: "go",
        source: "manual",
        logs: "",
        startedAt: new Date(),
      })
      .run();
    projectIds.push(projectId);

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
      if (args[0] === "run") return { stdout: "cid-integration\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await startAgentContainer({
      sessionId,
      projectId,
      branch: "main",
      cloneUrl: "https://example.com/repo.git",
      opsBaseUrl: "http://127.0.0.1:3456",
      opsToken: "fos.test.token",
      workspaceBind: "/data/repos/shatterfield-main",
    });

    const runArgs = seen.find((a) => a[0] === "run");
    expect(runArgs).toContain(
      "/host/forge-data/_data/repos/shatterfield-main:/workspace/repo:z",
    );
    expect(runArgs?.some((a) => a.startsWith("/data/repos/"))).toBe(false);
    expect(runArgs).toContain("--user");
    expect(runArgs).toContain("0:0");

    db.delete(agentContainers).where(eq(agentContainers.sessionId, sessionId)).run();
  });

  it("agent-runner syncs branches and agent-container resolves host binds", async () => {
    const { readFile } = await import("fs/promises");
    const runner = await readFile(
      join(process.cwd(), "src/lib/agent-runner.ts"),
      "utf8",
    );
    const container = await readFile(
      join(process.cwd(), "src/lib/agent-container.ts"),
      "utf8",
    );
    expect(runner).toMatch(/ensureLocalBranchForAgent/);
    expect(container).toMatch(/resolveHostBindPath/);
    expect(container).toMatch(/ensureAgentImage/);
  });

  it("ensureLocalBranchForAgent materializes main when the working tree is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-agent-startup-"));
    const bareDir = join(root, "remote.git");
    const clonePath = join(root, "work");
    try {
      await runGit(root, ["init", "--bare", bareDir]);
      const seed = join(root, "seed");
      await runGit(root, ["clone", bareDir, seed]);
      await runGit(seed, ["checkout", "-b", "main"]);
      await runGit(seed, ["config", "user.email", "test@example.com"]);
      await runGit(seed, ["config", "user.name", "Test"]);
      await writeFile(join(seed, "README"), "hi\n");
      await runGit(seed, ["add", "README"]);
      await runGit(seed, ["commit", "-m", "init"]);
      await runGit(seed, ["push", "-u", "origin", "main"]);

      const projectId = randomUUID();
      db.insert(projects)
        .values({
          id: projectId,
          name: "Startup Test",
          githubRepo: bareDir,
          branch: "main",
          clonePath,
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      projectIds.push(projectId);

      const { ensureLocalBranchForAgent, listLocalBranches } = await import(
        "@/lib/github"
      );
      expect(await listLocalBranches(clonePath)).toEqual([]);

      await ensureLocalBranchForAgent(
        projectRemoteUrl(
          db.select().from(projects).where(eq(projects.id, projectId)).get()!,
        ),
        "main",
        clonePath,
        "main",
        () => {},
      );
      expect(await listLocalBranches(clonePath)).toContain("main");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolveHostBindPath leaves host paths unchanged outside /data mounts", async () => {
    process.env.FORGE_CONTAINER_NAME = "forge_app_1";
    setAgentContainerDockerRunner(async (args) => {
      if (args[0] === "inspect") {
        return {
          stdout: JSON.stringify([
            {
              Mounts: [{ Source: "/host/vol", Destination: "/data" }],
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    expect(await resolveHostBindPath("/tmp/outside-data")).toBe("/tmp/outside-data");
  });
});
