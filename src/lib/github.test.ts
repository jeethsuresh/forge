import { execFile } from "child_process";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import { parseGithubRepo } from "@/lib/github";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

describe("parseGithubRepo", () => {
  it("accepts owner/repo shorthand", () => {
    expect(parseGithubRepo("acme/widget")).toBe("acme/widget");
  });

  it("parses HTTPS GitHub URLs", () => {
    expect(parseGithubRepo("https://github.com/acme/widget")).toBe(
      "acme/widget",
    );
    expect(parseGithubRepo("https://github.com/acme/widget.git")).toBe(
      "acme/widget",
    );
  });

  it("parses SSH GitHub URLs", () => {
    expect(parseGithubRepo("git@github.com:acme/widget.git")).toBe(
      "acme/widget",
    );
  });

  it("rejects invalid input", () => {
    expect(() => parseGithubRepo("not-a-repo")).toThrow(/Invalid GitHub/);
  });
});

describe("buildAgentCommitMessage", () => {
  it("prefixes the initial prompt", async () => {
    const { buildAgentCommitMessage } = await import("@/lib/github");
    expect(buildAgentCommitMessage("Add login page")).toBe("Agent: Add login page");
  });

  it("truncates long prompts", async () => {
    const { buildAgentCommitMessage } = await import("@/lib/github");
    const long = "x".repeat(100);
    const message = buildAgentCommitMessage(long);
    expect(message.startsWith("Agent: ")).toBe(true);
    expect(message.endsWith("…")).toBe(true);
    expect(message.length).toBeLessThan(100);
  });
});

describe("gitAuthorIdentity", () => {
  it("uses defaults when env vars are unset", async () => {
    const { gitAuthorIdentity } = await import("@/lib/github");
    const prevName = process.env.FORGE_GIT_USER_NAME;
    const prevEmail = process.env.FORGE_GIT_USER_EMAIL;
    delete process.env.FORGE_GIT_USER_NAME;
    delete process.env.FORGE_GIT_USER_EMAIL;
    try {
      expect(gitAuthorIdentity()).toEqual({
        name: "Forge Agent",
        email: "forge-agent@localhost",
      });
    } finally {
      if (prevName === undefined) delete process.env.FORGE_GIT_USER_NAME;
      else process.env.FORGE_GIT_USER_NAME = prevName;
      if (prevEmail === undefined) delete process.env.FORGE_GIT_USER_EMAIL;
      else process.env.FORGE_GIT_USER_EMAIL = prevEmail;
    }
  });

  it("reads FORGE_GIT_USER_NAME and FORGE_GIT_USER_EMAIL", async () => {
    const { gitAuthorIdentity } = await import("@/lib/github");
    const prevName = process.env.FORGE_GIT_USER_NAME;
    const prevEmail = process.env.FORGE_GIT_USER_EMAIL;
    process.env.FORGE_GIT_USER_NAME = "Test User";
    process.env.FORGE_GIT_USER_EMAIL = "test@example.com";
    try {
      expect(gitAuthorIdentity()).toEqual({
        name: "Test User",
        email: "test@example.com",
      });
    } finally {
      if (prevName === undefined) delete process.env.FORGE_GIT_USER_NAME;
      else process.env.FORGE_GIT_USER_NAME = prevName;
      if (prevEmail === undefined) delete process.env.FORGE_GIT_USER_EMAIL;
      else process.env.FORGE_GIT_USER_EMAIL = prevEmail;
    }
  });
});

describe("gitHubCredentials", () => {
  const envKeys = [
    "FORGE_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "FORGE_GIT_PASSWORD",
    "FORGE_GIT_USERNAME",
    "FORGE_GIT_USER_NAME",
  ] as const;

  function saveEnv(): Record<string, string | undefined> {
    const saved: Record<string, string | undefined> = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    return saved;
  }

  function restoreEnv(saved: Record<string, string | undefined>): void {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }

  it("returns null when no token or password is set", async () => {
    const { gitHubCredentials } = await import("@/lib/github");
    const saved = saveEnv();
    try {
      expect(gitHubCredentials()).toBeNull();
    } finally {
      restoreEnv(saved);
    }
  });

  it("prefers FORGE_GITHUB_TOKEN over other secrets", async () => {
    const { gitHubCredentials } = await import("@/lib/github");
    const saved = saveEnv();
    process.env.FORGE_GITHUB_TOKEN = "forge-token";
    process.env.GITHUB_TOKEN = "gh-token";
    process.env.FORGE_GIT_PASSWORD = "password";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "git",
        password: "forge-token",
      });
    } finally {
      restoreEnv(saved);
    }
  });

  it("falls back to GITHUB_TOKEN then FORGE_GIT_PASSWORD", async () => {
    const { gitHubCredentials } = await import("@/lib/github");

    const savedGh = saveEnv();
    process.env.GITHUB_TOKEN = "gh-token";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "git",
        password: "gh-token",
      });
    } finally {
      restoreEnv(savedGh);
    }

    const savedPw = saveEnv();
    process.env.FORGE_GIT_PASSWORD = "secret";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "git",
        password: "secret",
      });
    } finally {
      restoreEnv(savedPw);
    }
  });

  it("uses FORGE_GIT_USERNAME then FORGE_GIT_USER_NAME for username", async () => {
    const { gitHubCredentials } = await import("@/lib/github");

    const savedUser = saveEnv();
    process.env.FORGE_GITHUB_TOKEN = "token";
    process.env.FORGE_GIT_USERNAME = "myuser";
    process.env.FORGE_GIT_USER_NAME = "Display Name";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "myuser",
        password: "token",
      });
    } finally {
      restoreEnv(savedUser);
    }

    const savedName = saveEnv();
    process.env.FORGE_GITHUB_TOKEN = "token";
    process.env.FORGE_GIT_USER_NAME = "Display Name";
    try {
      expect(gitHubCredentials()).toEqual({
        username: "Display Name",
        password: "token",
      });
    } finally {
      restoreEnv(savedName);
    }
  });
});

describe("formatGitError", () => {
  it("prefers stderr from exec errors", async () => {
    const { formatGitError } = await import("@/lib/github");
    expect(formatGitError({ stderr: "remote rejected", message: "Command failed" })).toBe(
      "remote rejected",
    );
  });

  it("falls back to message or string coercion", async () => {
    const { formatGitError } = await import("@/lib/github");
    expect(formatGitError({ message: "Command failed" })).toBe("Command failed");
    expect(formatGitError("network down")).toBe("network down");
  });
});

describe("hasUnpushedCommits", () => {
  it("returns false when local branch matches origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-sync-"));
    const bareDir = join(root, "remote.git");
    const workDir = join(root, "work");
    try {
      await runGit(root, ["init", "--bare", bareDir]);
      await runGit(root, ["clone", bareDir, workDir]);
      await runGit(workDir, ["checkout", "-b", "main"]);
      await writeFile(join(workDir, "README"), "hello\n");
      await runGit(workDir, ["add", "README"]);
      await runGit(workDir, [
        "config",
        "user.email",
        "test@example.com",
      ]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await runGit(workDir, ["commit", "-m", "init"]);
      await runGit(workDir, ["push", "-u", "origin", "main"]);

      const { hasUnpushedCommits } = await import("@/lib/github");
      expect(await hasUnpushedCommits(workDir, "main")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns true when local branch is ahead of origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-ahead-"));
    const bareDir = join(root, "remote.git");
    const workDir = join(root, "work");
    try {
      await runGit(root, ["init", "--bare", bareDir]);
      await runGit(root, ["clone", bareDir, workDir]);
      await runGit(workDir, ["checkout", "-b", "main"]);
      await runGit(workDir, ["config", "user.email", "test@example.com"]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "init"]);
      await runGit(workDir, ["push", "-u", "origin", "main"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "ahead"]);

      const { hasUnpushedCommits } = await import("@/lib/github");
      expect(await hasUnpushedCommits(workDir, "main")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("validateBranchName", () => {
  it("accepts common branch names", async () => {
    const { validateBranchName } = await import("@/lib/github");
    expect(validateBranchName("agent/my-feature")).toBeNull();
    expect(validateBranchName("feature-123")).toBeNull();
  });

  it("rejects invalid branch names", async () => {
    const { validateBranchName } = await import("@/lib/github");
    expect(validateBranchName("")).toBeTruthy();
    expect(validateBranchName("has space")).toBeTruthy();
    expect(validateBranchName("../escape")).toBeTruthy();
    expect(validateBranchName("/leading")).toBeTruthy();
    expect(validateBranchName("trailing/")).toBeTruthy();
    expect(validateBranchName("ends-with-dot.")).toBeTruthy();
  });
});

describe("createLocalBranchFromBase", () => {
  it("creates a new branch from the base branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-new-branch-"));
    const bareDir = join(root, "remote.git");
    const workDir = join(root, "work");
    try {
      await runGit(root, ["init", "--bare", bareDir]);
      await runGit(root, ["clone", bareDir, workDir]);
      await runGit(workDir, ["checkout", "-b", "main"]);
      await runGit(workDir, ["config", "user.email", "test@example.com"]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await writeFile(join(workDir, "README"), "hello\n");
      await runGit(workDir, ["add", "README"]);
      await runGit(workDir, ["commit", "-m", "init"]);
      await runGit(workDir, ["push", "-u", "origin", "main"]);

      const { createLocalBranchFromBase, listLocalBranches } = await import(
        "@/lib/github"
      );
      const logs: string[] = [];
      await createLocalBranchFromBase(
        "acme/repo",
        "main",
        workDir,
        "agent/test",
        (line) => logs.push(line),
      );

      const branches = await listLocalBranches(workDir);
      expect(branches).toContain("agent/test");
      expect(branches).toContain("main");
      expect(logs.some((line) => line.includes("agent/test"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("throws when the branch already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-dup-branch-"));
    const workDir = join(root, "work");
    try {
      await mkdir(workDir, { recursive: true });
      await runGit(workDir, ["init"]);
      await runGit(workDir, ["checkout", "-b", "main"]);
      await runGit(workDir, ["config", "user.email", "test@example.com"]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "init"]);
      await runGit(workDir, ["branch", "agent/existing"]);

      const { createLocalBranchFromBase } = await import("@/lib/github");
      await expect(
        createLocalBranchFromBase(
          "acme/repo",
          "main",
          workDir,
          "agent/existing",
          () => {},
        ),
      ).rejects.toThrow(/already exists/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("pushBranch", () => {
  it("pushes local commits to origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-push-"));
    const bareDir = join(root, "remote.git");
    const workDir = join(root, "work");
    try {
      await runGit(root, ["init", "--bare", bareDir]);
      await runGit(root, ["clone", bareDir, workDir]);
      await runGit(workDir, ["checkout", "-b", "agent/test"]);
      await runGit(workDir, ["config", "user.email", "test@example.com"]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "agent work"]);

      const { pushBranch, hasUnpushedCommits } = await import("@/lib/github");
      await pushBranch(workDir, "agent/test");
      expect(await hasUnpushedCommits(workDir, "agent/test")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("throws a readable error when push fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-push-fail-"));
    const workDir = join(root, "work");
    try {
      await mkdir(workDir, { recursive: true });
      await runGit(workDir, ["init"]);
      await runGit(workDir, ["checkout", "-b", "main"]);
      await runGit(workDir, ["config", "user.email", "test@example.com"]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "init"]);
      await runGit(workDir, [
        "remote",
        "add",
        "origin",
        join(root, "missing-remote.git"),
      ]);

      const { pushBranch } = await import("@/lib/github");
      await expect(pushBranch(workDir, "main")).rejects.toThrow(
        /Failed to push main to origin:/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("listAvailableBranches", () => {
  it("includes local and remote branches plus the default branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-branches-"));
    const bareDir = join(root, "remote.git");
    const workDir = join(root, "work");
    try {
      await runGit(root, ["init", "--bare", bareDir]);
      await runGit(root, ["clone", bareDir, workDir]);
      await runGit(workDir, ["checkout", "-b", "main"]);
      await runGit(workDir, ["config", "user.email", "test@example.com"]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "init"]);
      await runGit(workDir, ["push", "-u", "origin", "main"]);
      await runGit(workDir, ["checkout", "-b", "feature/x"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "feature"]);
      await runGit(workDir, ["push", "-u", "origin", "feature/x"]);
      await runGit(workDir, ["checkout", "main"]);
      await runGit(workDir, ["branch", "local-only"]);
      await runGit(bareDir, ["branch", "remote-only", "main"]);
      await runGit(workDir, ["fetch", "origin"]);

      const { listAvailableBranches } = await import("@/lib/github");
      const branches = await listAvailableBranches("main", workDir);

      expect(branches).toContain("main");
      expect(branches).toContain("feature/x");
      expect(branches).toContain("local-only");
      expect(branches).toContain("remote-only");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("isCommitAncestor", () => {
  it("detects ancestor relationships in a linear history", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-git-ancestor-"));
    const workDir = join(root, "work");
    try {
      await mkdir(workDir, { recursive: true });
      await runGit(workDir, ["init"]);
      await runGit(workDir, ["config", "user.email", "test@example.com"]);
      await runGit(workDir, ["config", "user.name", "Test"]);
      await runGit(workDir, ["commit", "--allow-empty", "-m", "first"]);
      const { stdout: olderStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: workDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const older = olderStdout.trim();
      await runGit(workDir, ["commit", "--allow-empty", "-m", "second"]);
      const { stdout: newerStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: workDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      const newer = newerStdout.trim();

      const { isCommitAncestor } = await import("@/lib/github");
      expect(await isCommitAncestor(older, newer, workDir)).toBe(true);
      expect(await isCommitAncestor(newer, older, workDir)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
