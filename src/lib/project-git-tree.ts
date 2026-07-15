import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import {
  formatGitError,
  hasRemotePushConflict,
  hasUnpushedCommits,
  isNonFastForwardPushError,
  listLocalBranches,
  pushBranch,
  validateBranchName,
} from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";
import { shortSha } from "@/lib/utils";

const execFileAsync = promisify(execFile);

const COMMITS_PER_BRANCH = 40;

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

async function execGit(
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { ...options, env: gitEnv() });
}

export interface GitTreeCommit {
  sha: string;
  shortSha: string;
  subject: string;
  authorDate: string;
  parents: string[];
}

export interface GitTreeBranch {
  name: string;
  headSha: string;
  commitShas: string[];
  isLocal: true;
  hasRemote: boolean;
  unpushed: boolean;
  remoteConflict: boolean;
  isWatchBranch: boolean;
}

export interface PushAllBranchesResult {
  pushed: string[];
  conflicts: string[];
  skipped: string[];
  errors: { branch: string; message: string }[];
}

export interface ProjectGitTree {
  branches: GitTreeBranch[];
  commits: Record<string, GitTreeCommit>;
}

export { hasUnpushedCommits, listLocalBranches };

export function validateBranchOperation(
  sourceBranch: string,
  targetBranch: string,
  options?: {
    deleteLocal?: boolean;
    watchBranch?: string;
    sourceBranch?: string;
  },
): string | null {
  const source = options?.sourceBranch ?? sourceBranch;
  const sourceError = validateBranchName(source);
  if (sourceError) return sourceError;
  const targetError = validateBranchName(targetBranch);
  if (targetError) return targetError;
  if (source === targetBranch) {
    return "Source and target branches must be different";
  }
  if (options?.deleteLocal && options.watchBranch && source === options.watchBranch) {
    return `Cannot delete the watch branch "${source}"`;
  }
  return null;
}

async function branchHasRemote(
  clonePath: string,
  branch: string,
): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--verify", `origin/${branch}`], {
      cwd: clonePath,
    });
    return true;
  } catch {
    return false;
  }
}

async function readBranchLog(
  clonePath: string,
  branch: string,
): Promise<GitTreeCommit[]> {
  const { stdout } = await execGit(
    [
      "log",
      branch,
      `-n`,
      String(COMMITS_PER_BRANCH),
      `--format=%H%x00%P%x00%s%x00%ci`,
    ],
    { cwd: clonePath },
  );

  const commits: GitTreeCommit[] = [];
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [sha, parentsRaw, subject, authorDate] = line.split("\0");
    if (!sha) continue;
    commits.push({
      sha,
      shortSha: shortSha(sha),
      subject: subject ?? "",
      authorDate: authorDate ?? "",
      parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
    });
  }
  return commits;
}

export async function buildProjectGitTree(
  clonePath: string,
  watchBranch: string,
  options?: { fetchRemote?: boolean },
): Promise<ProjectGitTree> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) {
    return { branches: [], commits: {} };
  }

  if (options?.fetchRemote !== false) {
    try {
      await execGit(["fetch", "--prune", "origin"], { cwd: resolvedPath });
    } catch {
      // Best-effort fetch.
    }
  }

  const localBranches = await listLocalBranches(clonePath);
  const commits: Record<string, GitTreeCommit> = {};
  const branches: GitTreeBranch[] = [];

  for (const name of localBranches) {
    const branchCommits = await readBranchLog(resolvedPath, name);
    for (const commit of branchCommits) {
      commits[commit.sha] = commit;
    }
    const headSha = branchCommits[0]?.sha ?? "";
    const unpushed = await hasUnpushedCommits(resolvedPath, name);
    branches.push({
      name,
      headSha,
      commitShas: branchCommits.map((c) => c.sha),
      isLocal: true,
      hasRemote: await branchHasRemote(resolvedPath, name),
      unpushed,
      remoteConflict: unpushed
        ? await hasRemotePushConflict(resolvedPath, name)
        : false,
      isWatchBranch: name === watchBranch,
    });
  }

  branches.sort((a, b) => {
    if (a.isWatchBranch) return -1;
    if (b.isWatchBranch) return 1;
    return a.name.localeCompare(b.name);
  });

  return { branches, commits };
}

export async function ensureBranchPushed(
  clonePath: string,
  branch: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  try {
    await execGit(["fetch", "origin", branch], { cwd: resolvedPath });
  } catch {
    // Remote branch may not exist yet.
  }

  if (await hasUnpushedCommits(resolvedPath, branch)) {
    log(`Pushing ${branch} to origin before continuing…`);
    await pushBranch(resolvedPath, branch, log);
  }
}

export async function checkoutLocalBranch(
  clonePath: string,
  branch: string,
): Promise<void> {
  try {
    await execGit(["checkout", branch], { cwd: clonePath });
  } catch (err) {
    throw new Error(formatGitError(err));
  }
}

export async function ensureLocalBranch(
  clonePath: string,
  branch: string,
): Promise<void> {
  const locals = await listLocalBranches(clonePath);
  if (locals.includes(branch)) return;

  try {
    await execGit(["checkout", "-b", branch, `origin/${branch}`], {
      cwd: clonePath,
    });
  } catch (err) {
    throw new Error(`Branch "${branch}" is not available locally: ${formatGitError(err)}`);
  }
}

export async function rebaseProjectBranch(
  clonePath: string,
  branch: string,
  ontoBranch: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const validationError = validateBranchOperation(branch, ontoBranch);
  if (validationError) throw new Error(validationError);

  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  await execGit(["fetch", "origin"], { cwd: resolvedPath });
  await ensureLocalBranch(resolvedPath, branch);
  await ensureLocalBranch(resolvedPath, ontoBranch);

  await checkoutLocalBranch(resolvedPath, branch);
  await ensureBranchPushed(resolvedPath, branch, log);

  log(`Rebasing ${branch} onto ${ontoBranch}…`);
  try {
    await execGit(["rebase", ontoBranch], { cwd: resolvedPath });
  } catch (err) {
    try {
      await execGit(["rebase", "--abort"], { cwd: resolvedPath });
    } catch {
      // Ignore abort failures.
    }
    throw new Error(`Rebase failed: ${formatGitError(err)}`);
  }

  log(`Updating origin/${branch} after rebase…`);
  try {
    await execGit(["push", "--force-with-lease", "origin", branch], {
      cwd: resolvedPath,
    });
  } catch (err) {
    throw new Error(`Rebase succeeded locally but push failed: ${formatGitError(err)}`);
  }
  log(`Rebased ${branch} onto ${ontoBranch}.`);
}

export async function mergeProjectBranch(
  clonePath: string,
  sourceBranch: string,
  targetBranch: string,
  options?: { deleteLocal?: boolean; watchBranch?: string },
  onLog?: (line: string) => void,
): Promise<void> {
  const validationError = validateBranchOperation(sourceBranch, targetBranch, {
    deleteLocal: options?.deleteLocal,
    watchBranch: options?.watchBranch,
    sourceBranch,
  });
  if (validationError) throw new Error(validationError);

  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  await execGit(["fetch", "origin"], { cwd: resolvedPath });
  await ensureLocalBranch(resolvedPath, sourceBranch);
  await ensureLocalBranch(resolvedPath, targetBranch);

  await checkoutLocalBranch(resolvedPath, sourceBranch);
  await ensureBranchPushed(resolvedPath, sourceBranch, log);

  await checkoutLocalBranch(resolvedPath, targetBranch);
  log(`Merging ${sourceBranch} into ${targetBranch}…`);
  try {
    await execGit(["merge", sourceBranch, "--no-edit"], { cwd: resolvedPath });
  } catch (err) {
    try {
      await execGit(["merge", "--abort"], { cwd: resolvedPath });
    } catch {
      // Ignore abort failures.
    }
    throw new Error(`Merge failed: ${formatGitError(err)}`);
  }

  log(`Pushing ${targetBranch} to origin…`);
  await pushBranch(resolvedPath, targetBranch, log);

  if (options?.deleteLocal) {
    log(`Deleting local branch ${sourceBranch}…`);
    try {
      await execGit(["branch", "-d", sourceBranch], { cwd: resolvedPath });
    } catch {
      await execGit(["branch", "-D", sourceBranch], { cwd: resolvedPath });
    }
    log(`Deleted local branch ${sourceBranch} (remote unchanged).`);
  }

  log(`Merged ${sourceBranch} into ${targetBranch}.`);
}

export async function listRemoteConflictBranches(
  clonePath: string,
): Promise<string[]> {
  const resolvedPath = resolveClonePath(clonePath);
  const conflicts: string[] = [];
  for (const branch of await listLocalBranches(clonePath)) {
    if (await hasRemotePushConflict(resolvedPath, branch)) {
      conflicts.push(branch);
    }
  }
  return conflicts.sort((a, b) => a.localeCompare(b));
}

export async function pushAllUnpushedBranches(
  clonePath: string,
  onLog?: (line: string) => void,
): Promise<PushAllBranchesResult> {
  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  try {
    await execGit(["fetch", "--prune", "origin"], { cwd: resolvedPath });
  } catch {
    // Best-effort fetch before pushing.
  }

  const pushed: string[] = [];
  const conflicts: string[] = [];
  const skipped: string[] = [];
  const errors: { branch: string; message: string }[] = [];

  for (const branch of await listLocalBranches(clonePath)) {
    if (!(await hasUnpushedCommits(resolvedPath, branch))) {
      skipped.push(branch);
      continue;
    }
    if (await hasRemotePushConflict(resolvedPath, branch)) {
      log(`Skipping ${branch}: diverged from origin/${branch}`);
      conflicts.push(branch);
      continue;
    }
    try {
      await pushBranch(resolvedPath, branch, log);
      pushed.push(branch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isNonFastForwardPushError(message)) {
        log(`Push rejected for ${branch}: remote has diverged`);
        conflicts.push(branch);
      } else {
        errors.push({ branch, message });
      }
    }
  }

  return { pushed, conflicts, skipped, errors };
}

export function buildRemoteConflictResolutionPrompt(branch: string): string {
  return [
    `The local branch "${branch}" has diverged from origin/${branch}.`,
    "Remote has commits that are not in your local branch, and you have local commits that are not on the remote.",
    `Fetch the latest from origin, rebase or merge with origin/${branch}, resolve any conflicts, and push when ready.`,
    "Do not force-push unless absolutely necessary.",
  ].join(" ");
}
