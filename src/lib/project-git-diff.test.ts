import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import {
  buildProjectDiffHref,
  rebasePreviewDiffHref,
} from "@/lib/project-diff-url";
import { resolveDiffModeFromParams } from "@/lib/project-git-diff";

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
  await writeFile(join(workDir, "README.md"), "main\n");
  await runGit(workDir, ["add", "README.md"]);
  await runGit(workDir, ["commit", "-m", "main init"]);
  return workDir;
}

describe("project diff URL helpers", () => {
  it("builds diff tab links with query params", () => {
    expect(
      buildProjectDiffHref("proj-1", {
        mode: "range",
        base: "abc",
        head: "def",
      }),
    ).toBe("/projects/proj-1?tab=diff&mode=range&base=abc&head=def");
  });

  it("builds rebase preview links", () => {
    expect(rebasePreviewDiffHref("proj-1", "feature", "main")).toBe(
      "/projects/proj-1?tab=diff&mode=rebase&source=feature&onto=main",
    );
  });
});

describe("resolveDiffModeFromParams", () => {
  it("prefers explicit mode", () => {
    expect(
      resolveDiffModeFromParams({
        mode: "merge",
        base: null,
        head: null,
        branch: null,
        source: "a",
        onto: null,
        target: "b",
        session: null,
      }),
    ).toBe("merge");
  });

  it("defaults session links to uncommitted", () => {
    expect(
      resolveDiffModeFromParams({
        mode: null,
        base: null,
        head: null,
        branch: null,
        source: null,
        onto: null,
        target: null,
        session: "sess-1",
      }),
    ).toBe("uncommitted");
  });
});

describe("buildProjectGitDiff", () => {
  it("returns uncommitted working tree diff", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-diff-"));
    try {
      const workDir = await initRepo(root);
      await writeFile(join(workDir, "README.md"), "main\nchanged\n");
      const { buildProjectGitDiff } = await import("@/lib/project-git-diff");
      const result = await buildProjectGitDiff(workDir, {
        mode: "uncommitted",
        watchBranch: "main",
        sessionBranch: "main",
      });
      expect(result.empty).toBe(false);
      expect(result.files.some((f) => f.path === "README.md")).toBe(true);
      expect(result.patch).toContain("changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compares branch tip against main with three-dot range", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-diff-"));
    try {
      const workDir = await initRepo(root);
      await runGit(workDir, ["checkout", "-b", "feature"]);
      await writeFile(join(workDir, "feature.txt"), "feature work\n");
      await runGit(workDir, ["add", "feature.txt"]);
      await runGit(workDir, ["commit", "-m", "feature commit"]);
      await runGit(workDir, ["checkout", "main"]);

      const { buildProjectGitDiff } = await import("@/lib/project-git-diff");
      const result = await buildProjectGitDiff(workDir, {
        mode: "branch-vs-main",
        watchBranch: "main",
        branch: "feature",
      });
      expect(result.empty).toBe(false);
      expect(result.files.some((f) => f.path === "feature.txt")).toBe(true);
      expect(result.label).toContain("feature vs main");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compares two explicit commits", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-diff-"));
    try {
      const workDir = await initRepo(root);
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: workDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const firstSha = stdout.trim();
      await writeFile(join(workDir, "second.txt"), "two\n");
      await runGit(workDir, ["add", "second.txt"]);
      await runGit(workDir, ["commit", "-m", "second"]);
      const { stdout: headOut } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD"],
        {
          cwd: workDir,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
      );
      const secondSha = headOut.trim();

      const { buildProjectGitDiff } = await import("@/lib/project-git-diff");
      const result = await buildProjectGitDiff(workDir, {
        mode: "range",
        watchBranch: "main",
        base: firstSha,
        head: secondSha,
      });
      expect(result.files.some((f) => f.path === "second.txt")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
