import { execFile } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branchWorkspaces, gitRepositories, projects } from "@/lib/db/schema";
import { resolveBranchWorkspacesRoot } from "@/lib/paths";
import {
  branchContainerName,
  branchWorkspacePath,
  branchWorkspaceSlug,
  destroyBranchWorkspace,
  destroyProjectBranchWorkspaces,
  ensureBranchWorkspace,
  getBranchWorkspace,
  pauseBranchWorkspace,
  resumeBranchWorkspace,
  setBranchWorkspaceDockerRunner,
} from "@/lib/branch-workspace";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function seedRemote(root: string): Promise<{ bareDir: string }> {
  const bareDir = join(root, "remote.git");
  const seed = join(root, "seed");
  await runGit(root, ["init", "--bare", bareDir]);
  await runGit(root, ["clone", bareDir, seed]);
  await runGit(seed, ["checkout", "-B", "main"]);
  await runGit(seed, ["config", "user.email", "test@example.com"]);
  await runGit(seed, ["config", "user.name", "Test"]);
  await writeFile(join(seed, "README.md"), "main\n");
  await runGit(seed, ["add", "README.md"]);
  await runGit(seed, ["commit", "-m", "init"]);
  await runGit(seed, ["checkout", "-b", "feat/editor"]);
  await writeFile(join(seed, "feature.txt"), "feat\n");
  await runGit(seed, ["add", "feature.txt"]);
  await runGit(seed, ["commit", "-m", "feature"]);
  await runGit(seed, ["push", "-u", "origin", "main"]);
  await runGit(seed, ["push", "-u", "origin", "feat/editor"]);
  return { bareDir };
}

function seedProject(barePath: string): {
  projectId: string;
  repoId: string;
} {
  const projectId = randomUUID();
  const repoId = randomUUID();
  const now = new Date();
  db.insert(gitRepositories)
    .values({
      id: repoId,
      slug: `branch-ws-${repoId.slice(0, 8)}`,
      barePath,
      defaultBranch: "main",
      createdAt: now,
    })
    .run();
  db.insert(projects)
    .values({
      id: projectId,
      name: `Branch WS ${projectId.slice(0, 8)}`,
      githubRepo: "",
      branch: "main",
      clonePath: `/tmp/clone-${projectId}`,
      gitRepositoryId: repoId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { projectId, repoId };
}

function loadProject(projectId: string) {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new Error("missing project");
  return project;
}

describe("branch workspace slug and paths", () => {
  it("uses a distinct slug for feat/foo vs feat-foo", () => {
    expect(branchWorkspaceSlug("feat/foo")).not.toBe(
      branchWorkspaceSlug("feat-foo"),
    );
    expect(branchWorkspaceSlug("feat/foo")).toMatch(/^feat-foo-[a-f0-9]{8}$/);
  });

  it("builds docker-safe container names", () => {
    const name = branchContainerName("abc-def-uuid", "feat/foo");
    expect(name.startsWith("forge-branch-")).toBe(true);
    expect(name).not.toMatch(/[\/:]/);
  });

  it("resolves workspaces next to the database", () => {
    expect(resolveBranchWorkspacesRoot()).toMatch(/branch-workspaces/);
  });
});

describe("ensureBranchWorkspace", () => {
  const seen: string[][] = [];

  afterEach(() => {
    setBranchWorkspaceDockerRunner(null);
    seen.length = 0;
  });

  function mockDocker() {
    setBranchWorkspaceDockerRunner(async (args) => {
      seen.push([...args]);
      if (args[0] === "inspect" && args[1] === "-f") {
        throw new Error("no container");
      }
      if (args[0] === "image") return { stdout: "[]\n", stderr: "" };
      if (args[0] === "run") return { stdout: "cidbranch\n", stderr: "" };
      if (args[0] === "stop" || args[0] === "start" || args[0] === "rm") {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
  }

  it("clones the requested branch and records a workspace row", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-branch-ws-"));
    process.env.FORGE_BRANCH_WORKSPACES_DIR = join(root, "workspaces");
    mockDocker();
    try {
      const { bareDir } = await seedRemote(root);
      const { projectId, repoId } = seedProject(bareDir);
      const workspace = await ensureBranchWorkspace(
        loadProject(projectId),
        "feat/editor",
      );

      expect(workspace.branch).toBe("feat/editor");
      expect(workspace.workspacePath).toBe(
        branchWorkspacePath(projectId, "feat/editor"),
      );
      expect(existsSync(join(workspace.workspacePath, "feature.txt"))).toBe(true);
      expect(existsSync(join(workspace.workspacePath, "README.md"))).toBe(true);

      const runArgs = seen.find((a) => a[0] === "run");
      expect(runArgs).toContain("-v");
      expect(runArgs?.some((a) => a.includes(":/workspace/repo:z"))).toBe(true);
      expect(runArgs?.some((a) => a.includes("docker.sock"))).toBe(false);

      const second = await ensureBranchWorkspace(
        loadProject(projectId),
        "feat/editor",
      );
      expect(second.id).toBe(workspace.id);

      db.delete(branchWorkspaces)
        .where(eq(branchWorkspaces.projectId, projectId))
        .run();
      db.delete(projects).where(eq(projects.id, projectId)).run();
      db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
    } finally {
      delete process.env.FORGE_BRANCH_WORKSPACES_DIR;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("pause then resume issues stop then start", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-branch-pause-"));
    process.env.FORGE_BRANCH_WORKSPACES_DIR = join(root, "workspaces");
    mockDocker();
    try {
      const { bareDir } = await seedRemote(root);
      const { projectId, repoId } = seedProject(bareDir);
      await ensureBranchWorkspace(loadProject(projectId), "main");
      seen.length = 0;
      await pauseBranchWorkspace(projectId, "main");
      expect(seen.some((a) => a[0] === "stop")).toBe(true);
      expect(getBranchWorkspace(projectId, "main")?.status).toBe("paused");

      seen.length = 0;
      setBranchWorkspaceDockerRunner(async (args) => {
        seen.push([...args]);
        if (args[0] === "inspect") {
          return { stdout: "idfalse false\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      });
      await resumeBranchWorkspace(projectId, "main");
      expect(seen.some((a) => a[0] === "start")).toBe(true);
      expect(getBranchWorkspace(projectId, "main")?.status).toBe("running");

      db.delete(branchWorkspaces)
        .where(eq(branchWorkspaces.projectId, projectId))
        .run();
      db.delete(projects).where(eq(projects.id, projectId)).run();
      db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
    } finally {
      delete process.env.FORGE_BRANCH_WORKSPACES_DIR;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("destroy removes the checkout and row", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-branch-destroy-"));
    process.env.FORGE_BRANCH_WORKSPACES_DIR = join(root, "workspaces");
    mockDocker();
    try {
      const { bareDir } = await seedRemote(root);
      const { projectId, repoId } = seedProject(bareDir);
      const workspace = await ensureBranchWorkspace(
        loadProject(projectId),
        "main",
      );
      mkdirSync(workspace.workspacePath, { recursive: true });
      await destroyBranchWorkspace(projectId, "main");
      expect(getBranchWorkspace(projectId, "main")).toBeUndefined();
      expect(existsSync(workspace.workspacePath)).toBe(false);
      expect(seen.some((a) => a[0] === "rm")).toBe(true);

      await ensureBranchWorkspace(loadProject(projectId), "feat/editor");
      await destroyProjectBranchWorkspaces(projectId);
      expect(
        db
          .select()
          .from(branchWorkspaces)
          .where(eq(branchWorkspaces.projectId, projectId))
          .all(),
      ).toEqual([]);

      db.delete(projects).where(eq(projects.id, projectId)).run();
      db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
    } finally {
      delete process.env.FORGE_BRANCH_WORKSPACES_DIR;
      await rm(root, { recursive: true, force: true });
    }
  });
});
