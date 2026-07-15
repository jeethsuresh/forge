import { execFile } from "child_process";
import { promisify } from "util";
import {
  formatGitError,
  listLocalBranches,
  validateBranchName,
} from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";

const execFileAsync = promisify(execFile);

export const NOT_FULLY_MERGED_CODE = "NOT_FULLY_MERGED" as const;

export class LocalBranchOpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "LocalBranchOpError";
    this.code = options?.code ?? "LOCAL_BRANCH_OP_FAILED";
    this.status = options?.status ?? 400;
  }
}

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

async function execGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, env: gitEnv() });
}

export async function getCurrentLocalBranch(clonePath: string): Promise<string | null> {
  const resolvedPath = resolveClonePath(clonePath);
  try {
    const { stdout } = await execGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      resolvedPath,
    );
    const name = stdout.trim();
    if (!name || name === "HEAD") return null;
    return name;
  } catch {
    return null;
  }
}

function assertBranchAllowed(
  branch: string,
  options: { currentBranch: string | null; watchBranch: string },
): void {
  const nameError = validateBranchName(branch);
  if (nameError) {
    throw new LocalBranchOpError(nameError, { status: 400 });
  }
  if (options.watchBranch && branch === options.watchBranch) {
    throw new LocalBranchOpError(
      `Cannot modify the watch/deploy branch "${branch}"`,
      { status: 400 },
    );
  }
  if (options.currentBranch && branch === options.currentBranch) {
    throw new LocalBranchOpError(
      `Cannot modify the currently checked-out branch "${branch}". Check out another branch first.`,
      { status: 400 },
    );
  }
}

export async function deleteLocalBranch(
  clonePath: string,
  branch: string,
  options: { watchBranch: string; force?: boolean },
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  const currentBranch = await getCurrentLocalBranch(clonePath);
  assertBranchAllowed(branch, {
    currentBranch,
    watchBranch: options.watchBranch,
  });

  const locals = await listLocalBranches(clonePath);
  if (!locals.includes(branch)) {
    throw new LocalBranchOpError(`Local branch "${branch}" not found`, {
      status: 404,
    });
  }

  const flag = options.force ? "-D" : "-d";
  try {
    await execGit(["branch", flag, branch], resolvedPath);
  } catch (err) {
    const detail = formatGitError(err);
    if (!options.force && /not fully merged|isn't fully merged/i.test(detail)) {
      throw new LocalBranchOpError(
        `Branch "${branch}" is not fully merged. Confirm force delete to remove it anyway.`,
        { code: NOT_FULLY_MERGED_CODE, status: 409 },
      );
    }
    throw new LocalBranchOpError(`Failed to delete branch: ${detail}`, {
      status: 500,
    });
  }
}

export async function renameLocalBranch(
  clonePath: string,
  branch: string,
  newName: string,
  options: { watchBranch: string },
): Promise<string> {
  const resolvedPath = resolveClonePath(clonePath);
  const trimmedNew = newName.trim();
  const newNameError = validateBranchName(trimmedNew);
  if (newNameError) {
    throw new LocalBranchOpError(newNameError, { status: 400 });
  }

  const currentBranch = await getCurrentLocalBranch(clonePath);
  assertBranchAllowed(branch, {
    currentBranch,
    watchBranch: options.watchBranch,
  });

  // Renaming would also leave watch/checkout pointing at a renamed tip name
  // if we allowed those; they are already blocked above.
  if (trimmedNew === options.watchBranch) {
    throw new LocalBranchOpError(
      `Cannot rename to the watch/deploy branch name "${trimmedNew}"`,
      { status: 400 },
    );
  }

  const locals = await listLocalBranches(clonePath);
  if (!locals.includes(branch)) {
    throw new LocalBranchOpError(`Local branch "${branch}" not found`, {
      status: 404,
    });
  }
  if (locals.includes(trimmedNew)) {
    throw new LocalBranchOpError(`Branch "${trimmedNew}" already exists`, {
      status: 409,
    });
  }

  try {
    await execGit(["branch", "-m", branch, trimmedNew], resolvedPath);
  } catch (err) {
    throw new LocalBranchOpError(
      `Failed to rename branch: ${formatGitError(err)}`,
      { status: 500 },
    );
  }
  return trimmedNew;
}
