import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import {
  assertSafeRepoRelativePath,
  languageIdForPath,
  readProjectGitFile,
  writeProjectGitFile,
} from "@/lib/project-git-file";

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

describe("assertSafeRepoRelativePath", () => {
  it("rejects path traversal", () => {
    expect(() =>
      assertSafeRepoRelativePath("/repo", "../etc/passwd"),
    ).toThrow(/Invalid file path/);
  });

  it("accepts normal relative paths", () => {
    expect(assertSafeRepoRelativePath("/repo", "src/app.ts")).toBe("src/app.ts");
  });
});

describe("languageIdForPath", () => {
  it("maps common extensions", () => {
    expect(languageIdForPath("src/app.tsx")).toBe("typescript");
    expect(languageIdForPath("README.md")).toBe("markdown");
    expect(languageIdForPath("Dockerfile")).toBe("dockerfile");
  });
});

describe("readProjectGitFile", () => {
  it("returns working tree content with diff decorations", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-file-"));
    try {
      const workDir = await initRepo(root);
      await writeFile(join(workDir, "README.md"), "main\nchanged\n");
      const file = await readProjectGitFile(workDir, {
        mode: "uncommitted",
        watchBranch: "main",
      }, "README.md");

      expect(file.editable).toBe(true);
      expect(file.content).toContain("changed");
      expect(file.status).toBe("modified");
      expect(file.decorations.lines.some((l) => l.kind === "added")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("writeProjectGitFile", () => {
  it("writes file content in the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-file-write-"));
    try {
      const workDir = await initRepo(root);
      await writeProjectGitFile(workDir, "notes.txt", "hello\n");
      const file = await readProjectGitFile(workDir, {
        mode: "uncommitted",
        watchBranch: "main",
      }, "notes.txt");
      expect(file.content).toBe("hello\n");
      expect(file.status).toBe("added");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
