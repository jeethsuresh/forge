import { execFile } from "child_process";
import { promisify } from "util";
import { chmod, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { resolveClonePath } from "@/lib/paths";

const execFileAsync = promisify(execFile);

let gitCredentialsConfigured = false;

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

async function execGit(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { ...options, env: gitEnv() });
}

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
  await ensureGitCredentialStore();
  const url = githubCloneUrl(repo);
  const { stdout } = await execGit([
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
    const { stdout } = await execGit(["rev-parse", "HEAD"], {
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
  const resolvedPath = resolveClonePath(clonePath);

  await ensureGitCredentialStore();

  if (!existsSync(resolvedPath)) {
    onLog(`Cloning ${url} (branch: ${branch})...`);
    await execGit(["clone", "--branch", branch, url, resolvedPath]);
    onLog("Clone complete.");
  } else {
    onLog("Fetching latest changes...");
    await execGit(["fetch", "origin", branch], { cwd: resolvedPath });
    onLog(`Checking out ${branch}...`);
    await execGit(["checkout", branch], { cwd: resolvedPath });
    await execGit(["reset", "--hard", `origin/${branch}`], {
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
  const resolvedCwd = resolveClonePath(cwd);
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
  const resolvedPath = resolveClonePath(clonePath);

  await ensureGitCredentialStore();

  if (!existsSync(resolvedPath)) {
    onLog(`Cloning ${url} (branch: ${branch})...`);
    await execGit(["clone", "--branch", branch, url, resolvedPath]);
    onLog("Clone complete.");
    return;
  }

  onLog("Fetching latest changes...");
  await execGit(["fetch", "origin"], { cwd: resolvedPath });
}

export async function checkoutBranch(
  clonePath: string,
  branch: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  try {
    await execGit(["checkout", branch], { cwd: resolvedPath });
  } catch {
    await execGit(["checkout", "-b", branch], { cwd: resolvedPath });
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
  const resolvedPath = resolveClonePath(clonePath);
  await ensureRepoCloned(repo, baseBranch, clonePath, onLog);

  onLog(`Syncing base branch ${baseBranch}...`);
  await execGit(["fetch", "origin", baseBranch], {
    cwd: resolvedPath,
  });
  await execGit(["checkout", baseBranch], { cwd: resolvedPath });
  await execGit(["reset", "--hard", `origin/${baseBranch}`], {
    cwd: resolvedPath,
  });

  onLog(`Creating agent branch ${newBranch}...`);
  try {
    await execGit(["branch", "-D", newBranch], { cwd: resolvedPath });
  } catch {
    // branch may not exist
  }
  await execGit(["checkout", "-b", newBranch], { cwd: resolvedPath });
  onLog(`Agent branch ${newBranch} ready.`);
}

export async function checkoutLocalBranch(
  clonePath: string,
  branch: string,
  onLog: (line: string) => void,
): Promise<string> {
  const resolvedPath = resolveClonePath(clonePath);
  await checkoutBranch(resolvedPath, branch, onLog);
  const sha = await getLocalCommitSha(resolvedPath);
  if (!sha) throw new Error("Failed to resolve local commit after checkout");
  return sha;
}

export async function listLocalBranches(clonePath: string): Promise<string[]> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) return [];

  try {
    const { stdout } = await execGit(
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
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) return false;

  const { stdout } = await execGit(["status", "--porcelain"], {
    cwd: resolvedPath,
  });
  return stdout.trim().length > 0;
}

export function buildAgentCommitMessage(initialPrompt: string): string {
  const prompt = initialPrompt.trim();
  const summary = prompt.length > 72 ? `${prompt.slice(0, 72)}…` : prompt;
  return `Agent: ${summary}`;
}

export function gitAuthorIdentity(): { name: string; email: string } {
  const name = process.env.FORGE_GIT_USER_NAME?.trim() || "Forge Agent";
  const email = process.env.FORGE_GIT_USER_EMAIL?.trim() || "forge-agent@localhost";
  return { name, email };
}

export function gitHubCredentials(): { username: string; password: string } | null {
  const password =
    process.env.FORGE_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.FORGE_GIT_PASSWORD?.trim() ||
    "";
  if (!password) return null;

  const username =
    process.env.FORGE_GIT_USERNAME?.trim() ||
    process.env.FORGE_GIT_USER_NAME?.trim() ||
    "git";
  return { username, password };
}

async function ensureGitCredentialStore(): Promise<void> {
  if (gitCredentialsConfigured) return;

  await execGit(["config", "--global", "--add", "safe.directory", "*"]);

  const creds = gitHubCredentials();
  if (!creds) {
    gitCredentialsConfigured = true;
    return;
  }

  const home = process.env.HOME ?? homedir();
  const credPath = join(home, ".git-credentials");
  const line = `https://${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password)}@github.com\n`;
  await writeFile(credPath, line, { mode: 0o600 });
  await chmod(credPath, 0o600);
  await execGit([
    "config",
    "--global",
    "credential.helper",
    `store --file ${credPath}`,
  ]);
  gitCredentialsConfigured = true;
}

async function ensureRepoGitIdentity(clonePath: string): Promise<void> {
  await ensureGitCredentialStore();
  const { name, email } = gitAuthorIdentity();
  await execGit(["config", "user.name", name], { cwd: clonePath });
  await execGit(["config", "user.email", email], { cwd: clonePath });
}

export async function commitAllChanges(
  clonePath: string,
  message: string,
  onLog?: (line: string) => void,
): Promise<string | null> {
  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  if (!(await hasUncommittedChanges(resolvedPath))) {
    log("No uncommitted changes to commit.");
    return null;
  }

  log("Staging agent changes…");
  await execGit(["add", "-A"], { cwd: resolvedPath });

  await ensureRepoGitIdentity(resolvedPath);

  log(`Committing: ${message}`);
  await execGit(["commit", "-m", message], { cwd: resolvedPath });

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
  const resolvedPath = resolveClonePath(clonePath);
  await ensureRepoCloned(repo, defaultBranch, clonePath, onLog);

  const branches = await listLocalBranches(clonePath);
  if (!branches.includes(branch)) {
    throw new Error(
      `Branch "${branch}" does not exist locally. Create it with git first.`,
    );
  }

  onLog(`Checking out branch ${branch} (local changes preserved)...`);
  await execGit(["checkout", branch], { cwd: resolvedPath });
  onLog(`Ready on branch ${branch}.`);
}
