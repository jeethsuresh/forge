import { execFile } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import {
  NOT_FULLY_MERGED_CODE,
  deleteLocalBranch,
  getCurrentLocalBranch,
  renameLocalBranch,
} from "@/lib/project-local-branch-ops";
import { listLocalBranches } from "@/lib/github";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function initRepo(root: string): Promise<string> {
  const workDir = join(root, "work");
  await runGit(root, ["init", workDir]);
  await runGit(workDir, ["checkout", "-b", "main"]);
  await runGit(workDir, ["config", "user.email", "test@example.com"]);
  await runGit(workDir, ["config", "user.name", "Test"]);
  await runGit(workDir, ["commit", "--allow-empty", "-m", "init"]);
  return workDir;
}

describe("project-local-branch-ops", () => {
  it("deletes a fully merged local branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-local-branch-del-"));
    try {
      const workDir = await initRepo(root);
      await runGit(workDir, ["branch", "feature/merged"]);
      await deleteLocalBranch(workDir, "feature/merged", { watchBranch: "main" });
      expect(await listLocalBranches(workDir)).not.toContain("feature/merged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses unmerged delete then allows force", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-local-branch-force-"));
    try {
      const workDir = await initRepo(root);
      await runGit(workDir, ["checkout", "-b", "feature/unmerged"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "wip"]);
      await runGit(workDir, ["checkout", "main"]);

      await expect(
        deleteLocalBranch(workDir, "feature/unmerged", { watchBranch: "main" }),
      ).rejects.toMatchObject({
        code: NOT_FULLY_MERGED_CODE,
        status: 409,
      });

      await deleteLocalBranch(workDir, "feature/unmerged", {
        watchBranch: "main",
        force: true,
      });
      expect(await listLocalBranches(workDir)).not.toContain("feature/unmerged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks delete of checkout and watch branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-local-branch-guard-"));
    try {
      const workDir = await initRepo(root);
      expect(await getCurrentLocalBranch(workDir)).toBe("main");
      await expect(
        deleteLocalBranch(workDir, "main", { watchBranch: "main" }),
      ).rejects.toThrow(/watch\/deploy|checked-out/i);

      await runGit(workDir, ["checkout", "-b", "other"]);
      await expect(
        deleteLocalBranch(workDir, "main", { watchBranch: "main" }),
      ).rejects.toThrow(/watch\/deploy/i);
      await expect(
        deleteLocalBranch(workDir, "other", { watchBranch: "main" }),
      ).rejects.toThrow(/checked-out/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renames a local branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-local-branch-ren-"));
    try {
      const workDir = await initRepo(root);
      await runGit(workDir, ["branch", "feature/old"]);
      const renamed = await renameLocalBranch(workDir, "feature/old", "feature/new", {
        watchBranch: "main",
      });
      expect(renamed).toBe("feature/new");
      const branches = await listLocalBranches(workDir);
      expect(branches).toContain("feature/new");
      expect(branches).not.toContain("feature/old");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
