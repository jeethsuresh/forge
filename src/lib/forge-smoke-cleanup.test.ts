import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  branchWorkspaces,
  deployments,
  forgeUpdates,
  projects,
} from "@/lib/db/schema";
import { getSessionForBranch } from "@/lib/agent-runner";
import {
  getBranchWorkspace,
  setBranchWorkspaceDockerRunner,
} from "@/lib/branch-workspace";
import { listLocalBranches } from "@/lib/git-workspace";
import { getCurrentLocalBranch } from "@/lib/project-local-branch-ops";
import {
  FORGE_SMOKE_CLEANUP_GRACE_MS,
  cleanupForgeSmokeBranch,
  maybeCleanupForgeSmokeAfterUpdate,
  sweepForgeSmokeLeftovers,
} from "@/lib/forge-smoke-cleanup";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function initSmokeRepo(root: string, smokeBranch: string): Promise<{
  workDir: string;
  bareDir: string;
}> {
  const bareDir = join(root, "remote.git");
  const workDir = join(root, "work");
  await runGit(root, ["init", "--bare", bareDir]);
  await runGit(root, ["clone", bareDir, workDir]);
  await runGit(workDir, ["checkout", "-b", "main"]);
  await runGit(workDir, ["config", "user.email", "test@example.com"]);
  await runGit(workDir, ["config", "user.name", "Test"]);
  await runGit(workDir, ["commit", "--allow-empty", "-m", "init"]);
  await runGit(workDir, ["push", "-u", "origin", "main"]);
  await runGit(workDir, ["checkout", "-b", smokeBranch]);
  await runGit(workDir, ["commit", "--allow-empty", "-m", "smoke marker"]);
  await runGit(workDir, ["push", "-u", "origin", smokeBranch]);
  await runGit(workDir, ["checkout", "main"]);
  return { workDir, bareDir };
}

async function remoteHeads(bareDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    { cwd: bareDir },
  );
  return stdout.trim().split("\n").filter(Boolean);
}

describe("forge-smoke-cleanup", () => {
  const ids: string[] = [];
  const updateIds: string[] = [];
  let rootDir = "";

  afterEach(async () => {
    setBranchWorkspaceDockerRunner(null);
    for (const id of ids.splice(0)) {
      db.delete(agentSessions).where(eq(agentSessions.projectId, id)).run();
      db.delete(branchWorkspaces).where(eq(branchWorkspaces.projectId, id)).run();
      db.delete(deployments).where(eq(deployments.projectId, id)).run();
      db.delete(projects).where(eq(projects.id, id)).run();
    }
    for (const updateId of updateIds.splice(0)) {
      db.delete(forgeUpdates).where(eq(forgeUpdates.id, updateId)).run();
    }
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = "";
    }
  });

  async function seedProject(opts: {
    smokeBranch: string;
    sessionStatus: "running" | "completed" | "failed" | "idle";
    startedAt: Date;
    completedAt?: Date;
    projectBranch?: string;
    checkoutSmoke?: boolean;
    workspace?: boolean;
    update?: { id: string; status: "building" | "success" | "failed" };
  }) {
    rootDir = await mkdtemp(join(tmpdir(), "forge-smoke-cleanup-"));
    const { workDir } = await initSmokeRepo(rootDir, opts.smokeBranch);
    if (opts.checkoutSmoke) {
      await runGit(workDir, ["checkout", opts.smokeBranch]);
    }

    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    ids.push(projectId);

    db.insert(projects)
      .values({
        id: projectId,
        name: "Forge",
        githubRepo: "",
        branch: opts.projectBranch ?? "main",
        clonePath: workDir,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: opts.smokeBranch,
        status: opts.sessionStatus,
        initialPrompt: "smoke",
        logs: "",
        startedAt: opts.startedAt,
        completedAt: opts.completedAt,
      })
      .run();

    if (opts.workspace) {
      db.insert(branchWorkspaces)
        .values({
          id: randomUUID(),
          projectId,
          branch: opts.smokeBranch,
          workspacePath: join(rootDir, "ws"),
          containerName: `forge-branch-${projectId.slice(0, 8)}`,
          status: "stopped",
          createdAt: now,
        })
        .run();
    }

    if (opts.update) {
      updateIds.push(opts.update.id);
      db.insert(forgeUpdates)
        .values({
          id: opts.update.id,
          status: opts.update.status,
          trigger: "manual",
          logs: "",
          startedAt: now,
          completedAt:
            opts.update.status === "building" ? null : now,
        })
        .run();
      db.insert(deployments)
        .values({
          id: opts.update.id,
          projectId,
          branch: opts.smokeBranch,
          status: opts.update.status === "building" ? "building" : opts.update.status,
          trigger: "manual",
          logs: "",
          startedAt: now,
          completedAt:
            opts.update.status === "building" ? null : now,
        })
        .run();
    }

    setBranchWorkspaceDockerRunner(async () => ({ stdout: "", stderr: "" }));
    return { projectId, sessionId, workDir };
  }

  it("does not archive or delete while a smoke session is running", async () => {
    const smoke = "forge-smoke/running";
    const { projectId, sessionId, workDir } = await seedProject({
      smokeBranch: smoke,
      sessionStatus: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      workspace: true,
    });

    const result = await cleanupForgeSmokeBranch(projectId, smoke);
    expect(result.cleaned).toBe(false);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.archivedAt).toBeNull();
    expect(getSessionForBranch(projectId, smoke)?.id).toBe(sessionId);
    expect(await listLocalBranches(workDir)).toContain(smoke);
    expect(getBranchWorkspace(projectId, smoke)).toBeTruthy();
  });

  it("does not clean while a forge update for that branch is in progress", async () => {
    const smoke = "forge-smoke/updating";
    const { projectId, workDir } = await seedProject({
      smokeBranch: smoke,
      sessionStatus: "completed",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 60 * 60 * 1000),
      update: { id: randomUUID(), status: "building" },
    });

    const result = await cleanupForgeSmokeBranch(projectId, smoke);
    expect(result.cleaned).toBe(false);
    expect(getSessionForBranch(projectId, smoke)).toBeTruthy();
    expect(await listLocalBranches(workDir)).toContain(smoke);
  });

  it("after a terminal update, archives the session, drops the workspace, and force-deletes git refs", async () => {
    const smoke = "forge-smoke/done";
    const updateId = randomUUID();
    const { projectId, sessionId, workDir } = await seedProject({
      smokeBranch: smoke,
      sessionStatus: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      workspace: true,
      update: { id: updateId, status: "success" },
    });

    await maybeCleanupForgeSmokeAfterUpdate(updateId);

    const ended = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(ended?.archivedAt).toBeTruthy();
    expect(getSessionForBranch(projectId, smoke)).toBeUndefined();
    expect(getBranchWorkspace(projectId, smoke)).toBeUndefined();
    expect(await listLocalBranches(workDir)).not.toContain(smoke);
    expect(await remoteHeads(join(rootDir, "remote.git"))).not.toContain(smoke);
  });

  it("sweeps a terminal smoke session older than the grace window", async () => {
    const smoke = "forge-smoke/stale";
    const startedAt = new Date(Date.now() - FORGE_SMOKE_CLEANUP_GRACE_MS - 5_000);
    const { projectId, workDir } = await seedProject({
      smokeBranch: smoke,
      sessionStatus: "failed",
      startedAt,
      completedAt: startedAt,
      workspace: true,
    });

    const swept = await sweepForgeSmokeLeftovers(new Date());
    expect(swept.cleaned).toContain(`${projectId}:${smoke}`);
    expect(getSessionForBranch(projectId, smoke)).toBeUndefined();
    expect(await listLocalBranches(workDir)).not.toContain(smoke);
  });

  it("leaves a terminal smoke session newer than the grace window", async () => {
    const smoke = "forge-smoke/fresh";
    const { projectId, workDir } = await seedProject({
      smokeBranch: smoke,
      sessionStatus: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const swept = await sweepForgeSmokeLeftovers(new Date());
    expect(swept.cleaned).toEqual([]);
    expect(getSessionForBranch(projectId, smoke)).toBeTruthy();
    expect(await listLocalBranches(workDir)).toContain(smoke);
  });

  it("never sweeps agent/* branches", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "forge-smoke-cleanup-"));
    const { workDir } = await initSmokeRepo(rootDir, "forge-smoke/other");
    await runGit(workDir, ["checkout", "-b", "agent/foo"]);
    await runGit(workDir, ["commit", "--allow-empty", "-m", "agent work"]);
    await runGit(workDir, ["checkout", "main"]);

    const projectId = randomUUID();
    const now = new Date(Date.now() - FORGE_SMOKE_CLEANUP_GRACE_MS * 2);
    ids.push(projectId);
    db.insert(projects)
      .values({
        id: projectId,
        name: "Forge",
        githubRepo: "",
        branch: "main",
        clonePath: workDir,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values({
        id: randomUUID(),
        projectId,
        branch: "agent/foo",
        status: "completed",
        initialPrompt: "real work",
        logs: "",
        startedAt: now,
        completedAt: now,
      })
      .run();

    await sweepForgeSmokeLeftovers(new Date());
    expect(getSessionForBranch(projectId, "agent/foo")).toBeTruthy();
    expect(await listLocalBranches(workDir)).toContain("agent/foo");
  });

  it("restores watch branch and HEAD off a smoke checkout before deleting", async () => {
    const smoke = "forge-smoke/stuck-head";
    const { projectId, workDir } = await seedProject({
      smokeBranch: smoke,
      sessionStatus: "completed",
      startedAt: new Date(Date.now() - FORGE_SMOKE_CLEANUP_GRACE_MS * 2),
      completedAt: new Date(Date.now() - FORGE_SMOKE_CLEANUP_GRACE_MS * 2),
      projectBranch: smoke,
      checkoutSmoke: true,
    });

    expect(await getCurrentLocalBranch(workDir)).toBe(smoke);

    await cleanupForgeSmokeBranch(projectId, smoke);

    expect(await getCurrentLocalBranch(workDir)).toBe("main");
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    expect(project?.branch).toBe("main");
    expect(await listLocalBranches(workDir)).not.toContain(smoke);
  });

  it("is idempotent when the smoke branch is already gone", async () => {
    const smoke = "forge-smoke/twice";
    const { projectId } = await seedProject({
      smokeBranch: smoke,
      sessionStatus: "completed",
      startedAt: new Date(Date.now() - FORGE_SMOKE_CLEANUP_GRACE_MS * 2),
      completedAt: new Date(Date.now() - FORGE_SMOKE_CLEANUP_GRACE_MS * 2),
    });

    await cleanupForgeSmokeBranch(projectId, smoke);
    await expect(cleanupForgeSmokeBranch(projectId, smoke)).resolves.toMatchObject({
      cleaned: true,
    });
  });
});
