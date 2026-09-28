import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, gitRepositories, projects } from "@/lib/db/schema";
import { listLocalBranches } from "@/lib/git-workspace";
import {
  getSessionForBranch,
  listAgentSessions,
  listArchivedAgentSessions,
} from "@/lib/agent-runner";
import { cleanupCompletedAgentSessions } from "@/lib/agent-session-cleanup";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

describe("cleanupCompletedAgentSessions", () => {
  const ids: string[] = [];
  let rootDir = "";
  let clonePath = "";
  let bareDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "forge-cleanup-"));
    bareDir = join(rootDir, "remote.git");
    clonePath = join(rootDir, "work");
    await runGit(rootDir, ["init", "--bare", bareDir]);
    await runGit(rootDir, ["clone", bareDir, clonePath]);
    await runGit(clonePath, ["checkout", "-b", "main"]);
    await runGit(clonePath, ["config", "user.email", "test@example.com"]);
    await runGit(clonePath, ["config", "user.name", "Test"]);
    await writeFile(join(clonePath, "README"), "hi\n");
    await runGit(clonePath, ["add", "README"]);
    await runGit(clonePath, ["commit", "-m", "init"]);
    await runGit(clonePath, ["push", "-u", "origin", "main"]);
    await runGit(clonePath, ["checkout", "-b", "agent/done"]);
    await runGit(clonePath, ["checkout", "-b", "agent/fail"]);
    await runGit(clonePath, ["checkout", "-b", "agent/live"]);
    await runGit(clonePath, ["checkout", "main"]);

    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name: `Cleanup Test ${id.slice(0, 8)}`,
        githubRepo: bareDir,
        branch: "main",
        clonePath,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const repoId = randomUUID();
    db.insert(gitRepositories)
      .values({
        id: repoId,
        slug: `cleanup-${id.slice(0, 8)}`,
        barePath: bareDir,
        defaultBranch: "main",
        createdAt: now,
      })
      .run();
    db.update(projects)
      .set({ gitRepositoryId: repoId })
      .where(eq(projects.id, id))
      .run();
    ids.push(id);
  });

  afterEach(async () => {
    for (const id of ids) {
      db.delete(agentSessions).where(eq(agentSessions.projectId, id)).run();
      const linked = db
        .select({ gitRepositoryId: projects.gitRepositoryId })
        .from(projects)
        .where(eq(projects.id, id))
        .get();
      db.delete(projects).where(eq(projects.id, id)).run();
      if (linked?.gitRepositoryId) {
        db.delete(gitRepositories)
          .where(eq(gitRepositories.id, linked.gitRepositoryId))
          .run();
      }
    }
    ids.length = 0;
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
      rootDir = "";
      clonePath = "";
      bareDir = "";
    }
  });

  it("archives completed agents, deletes their branches, and leaves others", async () => {
    const projectId = ids[0]!;
    const now = new Date();
    db.insert(agentSessions)
      .values([
        {
          id: randomUUID(),
          projectId,
          branch: "agent/done",
          status: "completed",
          initialPrompt: "done",
          source: "manual",
          logs: "",
          startedAt: now,
          completedAt: now,
        },
        {
          id: randomUUID(),
          projectId,
          branch: "main",
          status: "completed",
          initialPrompt: "on watch",
          source: "manual",
          logs: "",
          startedAt: now,
          completedAt: now,
        },
        {
          id: randomUUID(),
          projectId,
          branch: "agent/fail",
          status: "failed",
          initialPrompt: "fail",
          source: "manual",
          logs: "",
          startedAt: now,
          completedAt: now,
        },
        {
          id: randomUUID(),
          projectId,
          branch: "agent/live",
          status: "running",
          initialPrompt: "live",
          source: "manual",
          logs: "",
          startedAt: now,
        },
      ])
      .run();

    const result = await cleanupCompletedAgentSessions(projectId);

    expect(result.archivedSessionIds).toHaveLength(2);
    expect(result.deletedBranches).toEqual(["agent/done"]);
    expect(result.skipped.some((row) => row.branch === "main")).toBe(true);

    expect(getSessionForBranch(projectId, "agent/done")).toBeUndefined();
    expect(getSessionForBranch(projectId, "main")).toBeUndefined();
    expect(getSessionForBranch(projectId, "agent/fail")?.status).toBe("failed");
    expect(getSessionForBranch(projectId, "agent/live")?.status).toBe("running");

    expect(listAgentSessions(projectId).map((s) => s.branch).sort()).toEqual([
      "agent/fail",
      "agent/live",
    ]);
    expect(listArchivedAgentSessions(projectId)).toHaveLength(2);

    const locals = await listLocalBranches(clonePath);
    expect(locals).toContain("main");
    expect(locals).toContain("agent/fail");
    expect(locals).toContain("agent/live");
    expect(locals).not.toContain("agent/done");
  });
});
