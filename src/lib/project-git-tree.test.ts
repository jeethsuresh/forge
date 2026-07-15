import { execFile } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function initRepoWithMain(root: string): Promise<{
  bareDir: string;
  workDir: string;
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
  await runGit(bareDir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return { bareDir, workDir };
}

describe("buildProjectGitTree", () => {
  it("returns local branches with ordered commits", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-tree-"));
    try {
      const { workDir } = await initRepoWithMain(root);
      await runGit(workDir, ["checkout", "-b", "feature/a"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "feature work"]);
      await runGit(workDir, ["checkout", "main"]);

      const { buildProjectGitTree } = await import("@/lib/project-git-tree");
      const tree = await buildProjectGitTree(workDir, "main", { fetchRemote: false });

      expect(tree.branches.map((b) => b.name).sort()).toEqual(["feature/a", "main"]);
      const feature = tree.branches.find((b) => b.name === "feature/a");
      expect(feature?.commitShas.length).toBeGreaterThanOrEqual(2);
      expect(tree.commits[feature!.commitShas[0]!]?.subject).toBe("feature work");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ensureBranchPushed", () => {
  it("pushes unpushed commits before proceeding", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-tree-push-"));
    try {
      const { workDir } = await initRepoWithMain(root);
      await runGit(workDir, ["checkout", "-b", "feature/push"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "local only"]);

      const { ensureBranchPushed, hasUnpushedCommits } = await import(
        "@/lib/project-git-tree"
      );
      await ensureBranchPushed(workDir, "feature/push");
      expect(await hasUnpushedCommits(workDir, "feature/push")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("rebaseProjectBranch", () => {
  it("rebases a branch onto another and updates remote", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-tree-rebase-"));
    try {
      const { workDir } = await initRepoWithMain(root);
      await runGit(workDir, ["checkout", "-b", "feature/rebase"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "feature tip"]);
      await runGit(workDir, ["push", "-u", "origin", "feature/rebase"]);
      await runGit(workDir, ["checkout", "main"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "main moved"]);
      await runGit(workDir, ["push", "origin", "main"]);

      const { rebaseProjectBranch } = await import("@/lib/project-git-tree");
      await rebaseProjectBranch(workDir, "feature/rebase", "main");

      const { stdout } = await execFileAsync(
        "git",
        ["merge-base", "--is-ancestor", "main", "feature/rebase"],
        { cwd: workDir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      );
      expect(stdout).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("mergeProjectBranch", () => {
  it("merges into target and optionally deletes local source", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-tree-merge-"));
    try {
      const { workDir } = await initRepoWithMain(root);
      await runGit(workDir, ["checkout", "-b", "feature/merge"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "to merge"]);
      await runGit(workDir, ["push", "-u", "origin", "feature/merge"]);
      await runGit(workDir, ["checkout", "main"]);

      const { mergeProjectBranch, listLocalBranches } = await import(
        "@/lib/project-git-tree"
      );
      await mergeProjectBranch(workDir, "feature/merge", "main", {
        deleteLocal: true,
      });

      const branches = await listLocalBranches(workDir);
      expect(branches).not.toContain("feature/merge");
      expect(branches).toContain("main");

      const { stdout } = await execFileAsync(
        "git",
        ["branch", "--list", "feature/merge"],
        { cwd: workDir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      );
      expect(stdout.trim()).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("pushAllUnpushedBranches", () => {
  it("pushes all unpushed branches and skips remote conflicts", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-tree-push-all-"));
    try {
      const { workDir, bareDir } = await initRepoWithMain(root);
      await runGit(workDir, ["checkout", "-b", "feature/clean"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "clean local"]);
      await runGit(workDir, ["checkout", "-b", "feature/conflict"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "local diverge"]);
      await runGit(workDir, ["push", "-u", "origin", "feature/conflict"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "more local"]);
      const cloneDir = join(root, "remote-clone");
      await runGit(root, ["clone", bareDir, cloneDir]);
      await runGit(cloneDir, ["config", "user.email", "test@example.com"]);
      await runGit(cloneDir, ["config", "user.name", "Test"]);
      await runGit(cloneDir, ["checkout", "feature/conflict"]);
      await runGit(cloneDir, ["commit", "--allow-empty", "-m", "remote diverge"]);
      await runGit(cloneDir, ["push", "origin", "feature/conflict"]);
      await runGit(workDir, ["fetch", "origin"]);

      const { pushAllUnpushedBranches, hasUnpushedCommits } = await import(
        "@/lib/project-git-tree"
      );
      const result = await pushAllUnpushedBranches(workDir);

      expect(result.pushed).toEqual(["feature/clean"]);
      expect(result.conflicts).toEqual(["feature/conflict"]);
      expect(await hasUnpushedCommits(workDir, "feature/clean")).toBe(false);
      expect(await hasUnpushedCommits(workDir, "feature/conflict")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("validateBranchOperation", () => {
  it("rejects identical source and target branches", async () => {
    const { validateBranchOperation } = await import("@/lib/project-git-tree");
    expect(validateBranchOperation("main", "main")).toMatch(/different/i);
  });

  it("rejects deleting the watch branch", async () => {
    const { validateBranchOperation } = await import("@/lib/project-git-tree");
    expect(
      validateBranchOperation("main", "feature/x", {
        deleteLocal: true,
        watchBranch: "main",
        sourceBranch: "main",
      }),
    ).toMatch(/watch branch/i);
  });
});
