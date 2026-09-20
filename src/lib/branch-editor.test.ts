import { execFile } from "child_process";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import {
  commitBranchEditorChanges,
  listBranchEditorFiles,
  readBranchEditorFile,
  writeBranchEditorFile,
} from "@/lib/branch-editor";
import { assertSafeRepoRelativePath } from "@/lib/project-git-file";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function initRepo(root: string): Promise<{ workDir: string; bareDir: string }> {
  const workDir = join(root, "work");
  const bareDir = join(root, "remote.git");
  await runGit(root, ["init", "--bare", bareDir]);
  await runGit(root, ["clone", bareDir, workDir]);
  await runGit(workDir, ["checkout", "-B", "main"]);
  await runGit(workDir, ["config", "user.email", "test@example.com"]);
  await runGit(workDir, ["config", "user.name", "Test"]);
  await writeFile(join(workDir, "README.md"), "main\n");
  await mkdir(join(workDir, "src"), { recursive: true });
  await writeFile(join(workDir, "src/app.ts"), "export const n = 1;\n");
  await runGit(workDir, ["add", "."]);
  await runGit(workDir, ["commit", "-m", "main init"]);
  await runGit(workDir, ["push", "-u", "origin", "main"]);
  await runGit(workDir, ["checkout", "-b", "feat/tree"]);
  await writeFile(join(workDir, "src/app.ts"), "export const n = 2;\n");
  await writeFile(join(workDir, "src/new.ts"), "export const x = 1;\n");
  await runGit(workDir, ["add", "."]);
  await runGit(workDir, ["commit", "-m", "feature"]);
  return { workDir, bareDir };
}

describe("listBranchEditorFiles", () => {
  it("lists all HEAD files and marks vs-watch plus dirty paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-branch-editor-"));
    try {
      const { workDir } = await initRepo(root);
      await writeFile(join(workDir, "notes.txt"), "dirty\n");
      await writeFile(join(workDir, "README.md"), "main\nchanged\n");

      const files = await listBranchEditorFiles(workDir, "main");
      const byPath = Object.fromEntries(files.map((f) => [f.path, f.status]));

      expect(byPath["src/app.ts"]).toBe("modified");
      expect(byPath["src/new.ts"]).toBe("added");
      expect(byPath["notes.txt"]).toBe("untracked");
      expect(byPath["README.md"]).toBe("modified");
      expect(files.some((f) => f.path === "src/app.ts")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("read/write/commit branch editor", () => {
  it("rejects path traversal", () => {
    expect(() =>
      assertSafeRepoRelativePath("/repo", "../etc/passwd"),
    ).toThrow(/Invalid file path/);
  });

  it("reads decorations, writes, and commits+pushes on the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-branch-commit-"));
    try {
      const { workDir } = await initRepo(root);
      const file = await readBranchEditorFile(workDir, "main", "src/app.ts");
      expect(file.editable).toBe(true);
      expect(file.content).toContain("n = 2");
      expect(file.status).toBe("modified");

      await writeBranchEditorFile(workDir, "src/app.ts", "export const n = 3;\n");
      const dirty = await readBranchEditorFile(workDir, "main", "src/app.ts");
      expect(dirty.content).toContain("n = 3");

      const result = await commitBranchEditorChanges(
        workDir,
        "feat/tree",
        "editor commit",
      );
      expect(result.committed).toBe(true);
      expect(result.pushed).toBe(true);
      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

      const { stdout } = await execFileAsync(
        "git",
        ["log", "-1", "--format=%s"],
        { cwd: workDir },
      );
      expect(stdout.trim()).toBe("editor commit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
