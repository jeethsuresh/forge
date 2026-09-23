import { execFile } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";
import { barePathForSlug, resolveGitBareRoot } from "@/lib/git-paths";
import { installPostReceiveHook } from "@/lib/git-hooks";
import { workingClonePathForSlug } from "@/lib/git-repo";

const execFileAsync = promisify(execFile);

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: process.env.FORGE_GIT_USER_NAME?.trim() || "Forge",
    GIT_AUTHOR_EMAIL:
      process.env.FORGE_GIT_USER_EMAIL?.trim() || "forge@localhost",
    GIT_COMMITTER_NAME: process.env.FORGE_GIT_USER_NAME?.trim() || "Forge",
    GIT_COMMITTER_EMAIL:
      process.env.FORGE_GIT_USER_EMAIL?.trim() || "forge@localhost",
  };
}

async function execGit(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("git", args, { cwd, env: gitEnv() });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr)
        : "";
    const message =
      stderr.trim() || (err instanceof Error ? err.message : "git failed");
    throw new Error(message);
  }
}

export async function createRepositoryBundle(barePath: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "forge-bundle-"));
  const file = join(dir, "repo.bundle");
  try {
    await execGit(["bundle", "create", file, "--all"], barePath);
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function branchTip(
  barePath: string,
  branch: string,
): Promise<string | null> {
  try {
    const { stdout } = await execGit(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      barePath,
    );
    const sha = stdout.trim();
    return sha || null;
  } catch {
    return null;
  }
}

export async function materializeBareRepo(opts: {
  slug: string;
  bundle: Buffer | null;
  defaultBranch: string;
}): Promise<string> {
  const barePath = barePathForSlug(opts.slug);
  mkdirSync(resolveGitBareRoot(), { recursive: true });
  const bundleDir = opts.bundle
    ? mkdtempSync(join(tmpdir(), "forge-migrate-bundle-"))
    : null;
  try {
    if (!opts.bundle || !bundleDir) {
      await execGit(["init", "--bare", barePath]);
    } else {
      const bundlePath = join(bundleDir, "repo.bundle");
      writeFileSync(bundlePath, opts.bundle);
      await execGit(["clone", "--mirror", bundlePath, barePath]);
      const { stdout } = await execGit(["remote"], barePath);
      for (const name of stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
        await execGit(["remote", "remove", name], barePath);
      }
    }
    await execGit(["config", "http.receivepack", "true"], barePath);
    try {
      await execGit(
        ["symbolic-ref", "HEAD", `refs/heads/${opts.defaultBranch}`],
        barePath,
      );
    } catch {
      // Keep the bundled HEAD when the recorded default branch is absent.
    }
    installPostReceiveHook(barePath, opts.slug);
    return barePath;
  } catch (err) {
    rmSync(barePath, { recursive: true, force: true });
    throw err;
  } finally {
    if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
  }
}

export async function checkoutWatchBranch(opts: {
  barePath: string;
  slug: string;
  branch: string;
}): Promise<{ clonePath: string; commitSha: string | null }> {
  const clonePath = workingClonePathForSlug(opts.slug, opts.branch);
  const commitSha = await branchTip(opts.barePath, opts.branch);
  if (!commitSha) return { clonePath, commitSha: null };
  mkdirSync(dirname(clonePath), { recursive: true });
  try {
    await execGit(
      ["clone", "--branch", opts.branch, "--single-branch", opts.barePath, clonePath],
    );
  } catch (err) {
    rmSync(clonePath, { recursive: true, force: true });
    throw err;
  }
  return { clonePath, commitSha };
}
