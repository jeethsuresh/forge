import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Project } from "@/lib/db/schema";
import { formatGitError, listLocalBranches, validateBranchName } from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";
import { createRebaseRecoveryAgentSession } from "@/lib/agent-runner";
import {
  REBASE_RECOVERY_PROMPT_PREFIX,
  type RebaseRecoveryContext,
} from "@/lib/agent-session-source";
import {
  checkoutLocalBranch,
  ensureLocalBranch,
  validateBranchOperation,
} from "@/lib/project-git-tree";

const execFileAsync = promisify(execFile);

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

async function execGit(
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { ...options, env: gitEnv() });
}

export function buildRecoveryBranchName(sourceBranch: string): string {
  const sanitized = sourceBranch.replace(/[^a-zA-Z0-9/._-]/g, "-");
  return `forge-rebase/${sanitized}`;
}

async function uniqueRecoveryBranchName(
  clonePath: string,
  sourceBranch: string,
): Promise<string> {
  const base = buildRecoveryBranchName(sourceBranch);
  const locals = await listLocalBranches(clonePath);
  if (!locals.includes(base)) return base;

  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!locals.includes(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export function buildRebaseRecoveryPrompt(context: RebaseRecoveryContext): string {
  return `${REBASE_RECOVERY_PROMPT_PREFIX} Rebase of "${context.sourceBranch}" onto "${context.ontoBranch}" failed.

You are on recovery branch \`${context.recoveryBranch}\`, created from \`${context.ontoBranch}\`.
Commits from \`${context.sourceBranch}\` were cherry-picked onto this branch; resolve any conflicts and finish the cherry-pick sequence.

When the branch is clean and tests pass:
1. Call POST /api/projects/${context.projectId}/git-tree/rebase/finalize with recoveryBranch, sourceBranch, and onto.
2. That deletes the old \`${context.sourceBranch}\` branch and renames \`${context.recoveryBranch}\` to \`${context.sourceBranch}\` for continuity.

Error from the failed rebase:
${context.errorMessage}`;
}

async function cherryPickSourceOntoRecovery(
  clonePath: string,
  recoveryBranch: string,
  ontoBranch: string,
  sourceBranch: string,
): Promise<"complete" | "conflicts"> {
  const resolvedPath = resolveClonePath(clonePath);
  await checkoutLocalBranch(resolvedPath, recoveryBranch);
  try {
    await execGit(["cherry-pick", `${ontoBranch}..${sourceBranch}`], {
      cwd: resolvedPath,
    });
    return "complete";
  } catch {
    return "conflicts";
  }
}

export async function prepareRebaseRecoveryBranch(
  clonePath: string,
  sourceBranch: string,
  ontoBranch: string,
  onLog?: (line: string) => void,
): Promise<{ recoveryBranch: string; cherryPickState: "complete" | "conflicts" }> {
  const validationError = validateBranchOperation(sourceBranch, ontoBranch);
  if (validationError) throw new Error(validationError);

  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  await execGit(["fetch", "origin"], { cwd: resolvedPath });
  await ensureLocalBranch(resolvedPath, sourceBranch);
  await ensureLocalBranch(resolvedPath, ontoBranch);

  const recoveryBranch = await uniqueRecoveryBranchName(resolvedPath, sourceBranch);
  const branchError = validateBranchName(recoveryBranch);
  if (branchError) throw new Error(branchError);

  log(`Creating recovery branch ${recoveryBranch} from ${ontoBranch}…`);
  await checkoutLocalBranch(resolvedPath, ontoBranch);
  await execGit(["checkout", "-b", recoveryBranch], { cwd: resolvedPath });

  log(`Cherry-picking ${ontoBranch}..${sourceBranch} onto ${recoveryBranch}…`);
  const cherryPickState = await cherryPickSourceOntoRecovery(
    resolvedPath,
    recoveryBranch,
    ontoBranch,
    sourceBranch,
  );

  log(`Pushing recovery branch ${recoveryBranch} to origin…`);
  try {
    await execGit(["push", "-u", "origin", recoveryBranch], { cwd: resolvedPath });
  } catch (err) {
    throw new Error(
      `Recovery branch created locally but push failed: ${formatGitError(err)}`,
    );
  }

  return { recoveryBranch, cherryPickState };
}

export async function finalizeRebaseRecovery(
  clonePath: string,
  recoveryBranch: string,
  sourceBranch: string,
  options?: { watchBranch?: string; onLog?: (line: string) => void },
): Promise<void> {
  const validationError = validateBranchOperation(recoveryBranch, sourceBranch);
  if (validationError) throw new Error(validationError);

  if (options?.watchBranch && sourceBranch === options.watchBranch) {
    throw new Error(`Cannot replace the watch branch "${sourceBranch}"`);
  }

  const resolvedPath = resolveClonePath(clonePath);
  const log = options?.onLog ?? (() => {});

  const locals = await listLocalBranches(clonePath);
  if (!locals.includes(recoveryBranch)) {
    throw new Error(`Recovery branch "${recoveryBranch}" not found locally`);
  }

  await checkoutLocalBranch(resolvedPath, recoveryBranch);

  try {
    await execGit(["rev-parse", "--verify", "CHERRY_PICK_HEAD"], {
      cwd: resolvedPath,
    });
    throw new Error(
      "Cherry-pick is still in progress. Finish resolving conflicts before finalizing.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("Cherry-pick is still")) {
      throw err;
    }
  }

  try {
    await execGit(["rev-parse", "--verify", "REBASE_HEAD"], { cwd: resolvedPath });
    throw new Error(
      "Rebase is still in progress. Finish resolving conflicts before finalizing.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("still in progress")) {
      throw err;
    }
  }

  if (locals.includes(sourceBranch) && sourceBranch !== recoveryBranch) {
    log(`Deleting local branch ${sourceBranch}…`);
    try {
      await execGit(["branch", "-D", sourceBranch], { cwd: resolvedPath });
    } catch (err) {
      throw new Error(`Could not delete ${sourceBranch}: ${formatGitError(err)}`);
    }
  }

  log(`Renaming ${recoveryBranch} to ${sourceBranch}…`);
  await execGit(["branch", "-m", sourceBranch], { cwd: resolvedPath });

  log(`Force-pushing ${sourceBranch} to origin…`);
  try {
    await execGit(["push", "--force-with-lease", "origin", sourceBranch], {
      cwd: resolvedPath,
    });
  } catch (err) {
    throw new Error(`Rename succeeded locally but push failed: ${formatGitError(err)}`);
  }

  log(`Deleting remote recovery branch ${recoveryBranch}…`);
  try {
    await execGit(["push", "origin", "--delete", recoveryBranch], {
      cwd: resolvedPath,
    });
  } catch {
    // Recovery branch may not exist on remote if push failed earlier.
  }

  log(`Rebase recovery finalized: ${sourceBranch} updated.`);
}

export interface StartRebaseRecoveryResult {
  sessionId: string;
  recoveryBranch: string;
  cherryPickState: "complete" | "conflicts";
  autoFinalized?: boolean;
}

export async function startRebaseRecovery(
  project: Project,
  sourceBranch: string,
  ontoBranch: string,
  errorMessage: string,
): Promise<StartRebaseRecoveryResult> {
  const { recoveryBranch, cherryPickState } = await prepareRebaseRecoveryBranch(
    project.clonePath,
    sourceBranch,
    ontoBranch,
  );

  if (cherryPickState === "complete") {
    await finalizeRebaseRecovery(project.clonePath, recoveryBranch, sourceBranch, {
      watchBranch: project.branch,
    });
    return {
      sessionId: "",
      recoveryBranch,
      cherryPickState,
      autoFinalized: true,
    };
  }

  const sessionId = await createRebaseRecoveryAgentSession(
    project,
    recoveryBranch,
    buildRebaseRecoveryPrompt({
      projectId: project.id,
      sourceBranch,
      ontoBranch,
      recoveryBranch,
      errorMessage,
    }),
  );

  return { sessionId, recoveryBranch, cherryPickState };
}
