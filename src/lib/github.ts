import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join, resolve } from "path";

const execFileAsync = promisify(execFile);

export function parseGithubRepo(input: string): string {
  const trimmed = input.trim().replace(/\.git$/, "");

  const sshMatch = trimmed.match(/git@github\.com:([^/]+\/[^/]+)/);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = trimmed.match(/github\.com\/([^/]+\/[^/]+)/);
  if (httpsMatch) return httpsMatch[1];

  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed;

  throw new Error(`Invalid GitHub repository: ${input}`);
}

export function githubCloneUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

export async function getRemoteCommitSha(
  repo: string,
  branch: string,
): Promise<string> {
  const url = githubCloneUrl(repo);
  const { stdout } = await execFileAsync("git", [
    "ls-remote",
    url,
    `refs/heads/${branch}`,
  ]);
  const line = stdout.trim().split("\n")[0];
  if (!line) {
    throw new Error(`Branch "${branch}" not found on ${repo}`);
  }
  return line.split("\t")[0];
}

export async function getLocalCommitSha(repoPath: string): Promise<string | null> {
  if (!existsSync(repoPath)) return null;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function cloneOrPull(
  repo: string,
  branch: string,
  clonePath: string,
  onLog: (line: string) => void,
): Promise<string> {
  const url = githubCloneUrl(repo);
  const resolvedPath = resolve(clonePath);

  if (!existsSync(resolvedPath)) {
    onLog(`Cloning ${url} (branch: ${branch})...`);
    await execFileAsync("git", ["clone", "--branch", branch, url, resolvedPath]);
    onLog("Clone complete.");
  } else {
    onLog("Fetching latest changes...");
    await execFileAsync("git", ["fetch", "origin", branch], { cwd: resolvedPath });
    onLog(`Checking out ${branch}...`);
    await execFileAsync("git", ["checkout", branch], { cwd: resolvedPath });
    await execFileAsync("git", ["reset", "--hard", `origin/${branch}`], {
      cwd: resolvedPath,
    });
    onLog("Pull complete.");
  }

  const sha = await getLocalCommitSha(resolvedPath);
  if (!sha) throw new Error("Failed to resolve local commit after pull");
  return sha;
}

export async function runScript(
  scriptName: string,
  cwd: string,
  onLog: (line: string) => void,
): Promise<void> {
  const resolvedCwd = resolve(cwd);
  const scriptPath = join(resolvedCwd, scriptName);
  if (!existsSync(scriptPath)) {
    throw new Error(`${scriptName} not found in repository root`);
  }

  onLog(`Running ./${scriptName}...`);
  const { stdout, stderr } = await execFileAsync("bash", [scriptName], {
    cwd: resolvedCwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stdout) onLog(stdout.trimEnd());
  if (stderr) onLog(stderr.trimEnd());
  onLog(`${scriptName} finished.`);
}

export async function ensureRepoCloned(
  repo: string,
  branch: string,
  clonePath: string,
  onLog: (line: string) => void,
): Promise<void> {
  const url = githubCloneUrl(repo);
  const resolvedPath = resolve(clonePath);

  if (!existsSync(resolvedPath)) {
    onLog(`Cloning ${url} (branch: ${branch})...`);
    await execFileAsync("git", ["clone", "--branch", branch, url, resolvedPath]);
    onLog("Clone complete.");
    return;
  }

  onLog("Fetching latest changes...");
  await execFileAsync("git", ["fetch", "origin"], { cwd: resolvedPath });
}

export async function checkoutBranch(
  clonePath: string,
  branch: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolve(clonePath);
  const log = onLog ?? (() => {});

  try {
    await execFileAsync("git", ["checkout", branch], { cwd: resolvedPath });
  } catch {
    await execFileAsync("git", ["checkout", "-b", branch], { cwd: resolvedPath });
  }
  log(`Checked out branch ${branch}.`);
}

export async function createBranchFromBase(
  repo: string,
  baseBranch: string,
  clonePath: string,
  newBranch: string,
  onLog: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolve(clonePath);
  await ensureRepoCloned(repo, baseBranch, clonePath, onLog);

  onLog(`Syncing base branch ${baseBranch}...`);
  await execFileAsync("git", ["fetch", "origin", baseBranch], {
    cwd: resolvedPath,
  });
  await execFileAsync("git", ["checkout", baseBranch], { cwd: resolvedPath });
  await execFileAsync("git", ["reset", "--hard", `origin/${baseBranch}`], {
    cwd: resolvedPath,
  });

  onLog(`Creating agent branch ${newBranch}...`);
  try {
    await execFileAsync("git", ["branch", "-D", newBranch], { cwd: resolvedPath });
  } catch {
    // branch may not exist
  }
  await execFileAsync("git", ["checkout", "-b", newBranch], { cwd: resolvedPath });
  onLog(`Agent branch ${newBranch} ready.`);
}

export async function checkoutLocalBranch(
  clonePath: string,
  branch: string,
  onLog: (line: string) => void,
): Promise<string> {
  const resolvedPath = resolve(clonePath);
  await checkoutBranch(resolvedPath, branch, onLog);
  const sha = await getLocalCommitSha(resolvedPath);
  if (!sha) throw new Error("Failed to resolve local commit after checkout");
  return sha;
}

export async function listLocalBranches(clonePath: string): Promise<string[]> {
  const resolvedPath = resolve(clonePath);
  if (!existsSync(resolvedPath)) return [];

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      { cwd: resolvedPath },
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function hasUncommittedChanges(clonePath: string): Promise<boolean> {
  const resolvedPath = resolve(clonePath);
  if (!existsSync(resolvedPath)) return false;

  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: resolvedPath,
  });
  return stdout.trim().length > 0;
}

export function buildAgentCommitMessage(initialPrompt: string): string {
  const prompt = initialPrompt.trim();
  const summary = prompt.length > 72 ? `${prompt.slice(0, 72)}…` : prompt;
  return `Agent: ${summary}`;
}

export async function commitAllChanges(
  clonePath: string,
  message: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const resolvedPath = resolve(clonePath);
  const log = onLog ?? (() => {});

  if (!(await hasUncommittedChanges(resolvedPath))) {
    log("No uncommitted changes to commit.");
    return null;
  }

  log("Staging agent changes…");
  await execFileAsync("git", ["add", "-A"], { cwd: resolvedPath });

  log(`Committing: ${message}`);
  await execFileAsync("git", ["commit", "-m", message], { cwd: resolvedPath });

  const sha = await getLocalCommitSha(resolvedPath);
  if (!sha) throw new Error("Failed to resolve commit after commit");
  log(`Committed ${sha.slice(0, 7)}.`);
  return sha;
}

export async function prepareAgentWorkspace(
  repo: string,
  defaultBranch: string,
  clonePath: string,
  branch: string,
  onLog: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolve(clonePath);
  await ensureRepoCloned(repo, defaultBranch, clonePath, onLog);

  const branches = await listLocalBranches(clonePath);
  if (!branches.includes(branch)) {
    throw new Error(
      `Branch "${branch}" does not exist locally. Create it with git first.`,
    );
  }

  onLog(`Checking out branch ${branch} (local changes preserved)...`);
  await execFileAsync("git", ["checkout", branch], { cwd: resolvedPath });
  onLog(`Ready on branch ${branch}.`);
}
