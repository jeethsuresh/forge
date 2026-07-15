import { execFile } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { describe, expect, it } from "vitest";
import {
  REBASE_RECOVERY_PROMPT_PREFIX,
  agentSessionSourceLabel,
  resolveAgentSessionSource,
  shouldAutoCompleteRecoverySession,
} from "@/lib/agent-session-source";
import {
  buildRecoveryBranchName,
  buildRebaseRecoveryPrompt,
  finalizeRebaseRecovery,
  prepareRebaseRecoveryBranch,
} from "@/lib/rebase-recovery";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function initRepoWithMain(root: string): Promise<string> {
  const bareDir = join(root, "remote.git");
  const workDir = join(root, "work");
  await runGit(root, ["init", "--bare", bareDir]);
  await runGit(root, ["clone", bareDir, workDir]);
  await runGit(workDir, ["checkout", "-b", "main"]);
  await runGit(workDir, ["config", "user.email", "test@example.com"]);
  await runGit(workDir, ["config", "user.name", "Test"]);
  await runGit(workDir, ["commit", "--allow-empty", "-m", "init"]);
  await runGit(workDir, ["push", "-u", "origin", "main"]);
  return workDir;
}

describe("rebase recovery helpers", () => {
  it("builds recovery branch names from source branches", () => {
    expect(buildRecoveryBranchName("feature/foo")).toBe("forge-rebase/feature/foo");
    expect(buildRecoveryBranchName("weird branch!")).toBe("forge-rebase/weird-branch-");
  });

  it("builds a rebase recovery prompt with finalize instructions", () => {
    const prompt = buildRebaseRecoveryPrompt({
      projectId: "proj-1",
      sourceBranch: "feature/x",
      ontoBranch: "main",
      recoveryBranch: "forge-rebase/feature/x",
      errorMessage: "conflict in file.ts",
    });
    expect(prompt.startsWith(REBASE_RECOVERY_PROMPT_PREFIX)).toBe(true);
    expect(prompt).toContain("feature/x");
    expect(prompt).toContain("git-tree/rebase/finalize");
  });

  it("recognizes rebase-recovery session source", () => {
    expect(
      resolveAgentSessionSource({
        source: "rebase-recovery",
        initialPrompt: "ignored",
      }),
    ).toBe("rebase-recovery");
    expect(
      resolveAgentSessionSource({
        initialPrompt: `${REBASE_RECOVERY_PROMPT_PREFIX} fix rebase`,
      }),
    ).toBe("rebase-recovery");
    expect(agentSessionSourceLabel("rebase-recovery")).toBe("Rebase recovery");
    expect(
      shouldAutoCompleteRecoverySession({
        source: "rebase-recovery",
        initialPrompt: "ignored",
      }),
    ).toBe(true);
  });
});

describe("prepareRebaseRecoveryBranch", () => {
  it("cherry-picks cleanly and can be finalized to the source branch name", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-rebase-recovery-"));
    try {
      const workDir = await initRepoWithMain(root);
      await runGit(workDir, ["checkout", "-b", "feature/rebase"]);
      await writeFile(join(workDir, "feature.txt"), "feature work\n");
      await runGit(workDir, ["add", "feature.txt"]);
      await runGit(workDir, ["commit", "-m", "feature tip"]);
      await runGit(workDir, ["push", "-u", "origin", "feature/rebase"]);
      await runGit(workDir, ["checkout", "main"]);
      await writeFile(join(workDir, "main.txt"), "main moved\n");
      await runGit(workDir, ["add", "main.txt"]);
      await runGit(workDir, ["commit", "-m", "main moved"]);
      await runGit(workDir, ["push", "origin", "main"]);

      const { recoveryBranch, cherryPickState } = await prepareRebaseRecoveryBranch(
        workDir,
        "feature/rebase",
        "main",
      );
      expect(cherryPickState).toBe("complete");
      expect(recoveryBranch).toBe("forge-rebase/feature/rebase");

      await finalizeRebaseRecovery(workDir, recoveryBranch, "feature/rebase");

      const { stdout } = await execFileAsync(
        "git",
        ["merge-base", "--is-ancestor", "main", "feature/rebase"],
        { cwd: workDir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      );
      expect(stdout).toBe("");

      const branches = (
        await execFileAsync(
          "git",
          ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
          { cwd: workDir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
        )
      ).stdout
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(branches).toContain("feature/rebase");
      expect(branches).not.toContain(recoveryBranch);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
