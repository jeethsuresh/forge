import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { chmod, writeFile } from "fs/promises";
import { DEFAULT_GIT_USER_NAME } from "@/lib/app-name";
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

export function formatGitError(err: unknown): string {
  if (err && typeof err === "object") {
    const execErr = err as { stderr?: string; message?: string };
    const stderr = execErr.stderr?.trim();
    if (stderr) return stderr;
    if (execErr.message) return execErr.message;
  }
  return String(err);
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

/** Accept owner/repo, absolute bare path, or http(s)/file URL. */
export function resolveGitRemoteUrl(repoOrUrl: string): string {
  const trimmed = repoOrUrl.trim();
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.includes("://") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  ) {
    return trimmed;
  }
  return githubCloneUrl(trimmed);
}

function isGitCheckout(path: string): boolean {
  return existsSync(join(path, ".git")) || existsSync(join(path, "HEAD"));
}

function prepareCloneTarget(resolvedPath: string): void {
  if (!existsSync(resolvedPath)) return;
  if (isGitCheckout(resolvedPath)) return;
  const entries = readdirSync(resolvedPath);
  if (entries.length === 0) {
    rmSync(resolvedPath, { recursive: true, force: true });
    return;
  }
  throw new Error(
    `Clone path exists but is not a git checkout: ${resolvedPath}`,
  );
}

/**
 * Point origin at `url` when missing or when migrating to a Forge bare/HTTP remote.
 * Do not overwrite a working local/test origin just because the caller passed owner/repo.
 */
async function ensureOriginUrl(cwd: string, url: string): Promise<void> {
  const isGithubHosted = url.includes("github.com");
  try {
    const { stdout } = await execGit(["remote", "get-url", "origin"], { cwd });
    const current = stdout.trim();
    if (!current) {
      await execGit(["remote", "add", "origin", url], { cwd });
      return;
    }
    if (current === url) return;
    if (isGithubHosted && !current.includes("github.com")) {
      return;
    }
    await execGit(["remote", "set-url", "origin", url], { cwd });
  } catch {
    try {
      await execGit(["remote", "add", "origin", url], { cwd });
    } catch {
      // keep existing remotes
    }
  }
}

export async function getRemoteCommitSha(
  repoOrUrl: string,
  branch: string,
): Promise<string> {
  const url = resolveGitRemoteUrl(repoOrUrl);
  if (url.includes("github.com")) {
    await ensureGitCredentialStore();
  }
  const { stdout } = await execGit([
    "ls-remote",
    url,
    `refs/heads/${branch}`,
  ]);
  const line = stdout.trim().split("\n")[0];
  if (!line) {
    throw new Error(`Branch "${branch}" not found on ${repoOrUrl}`);
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

export async function isCommitAncestor(
  ancestorSha: string,
  descendantSha: string,
  clonePath: string,
): Promise<boolean> {
  if (ancestorSha === descendantSha) return true;

  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) return false;

  try {
    await execGit(
      ["merge-base", "--is-ancestor", ancestorSha, descendantSha],
      { cwd: resolvedPath },
    );
    return true;
  } catch {
    return false;
  }
}

export async function cloneOrPull(
  repoOrUrl: string,
  branch: string,
  clonePath: string,
  onLog: (line: string) => void,
): Promise<string> {
  const url = resolveGitRemoteUrl(repoOrUrl);
  const resolvedPath = resolveClonePath(clonePath);

  if (url.includes("github.com")) {
    await ensureGitCredentialStore();
  }

  prepareCloneTarget(resolvedPath);

  if (!existsSync(resolvedPath) || !isGitCheckout(resolvedPath)) {
    onLog(`Cloning ${url} (branch: ${branch})...`);
    await execGit(["clone", "--branch", branch, url, resolvedPath]);
    onLog("Clone complete.");
  } else {
    onLog("Fetching latest changes...");
    await ensureOriginUrl(resolvedPath, url);
    await execGit(["fetch", "origin", branch], { cwd: resolvedPath });
    onLog(`Checking out ${branch}...`);
    try {
      await execGit(["checkout", branch], { cwd: resolvedPath });
    } catch {
      await execGit(["checkout", "-B", branch, `origin/${branch}`], {
        cwd: resolvedPath,
      });
    }
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
  options?: { env?: NodeJS.ProcessEnv; args?: string[] },
): Promise<void> {
  const resolvedCwd = resolveClonePath(cwd);
  const scriptPath = join(resolvedCwd, scriptName);
  if (!existsSync(scriptPath)) {
    throw new Error(`${scriptName} not found in repository root`);
  }

  const cliArgs = options?.args ?? [];
  onLog(`Running ./${scriptName}${cliArgs.length ? ` ${cliArgs.join(" ")}` : ""}...`);
  const { stdout, stderr } = await execFileAsync(
    "bash",
    [scriptName, ...cliArgs],
    {
      cwd: resolvedCwd,
      maxBuffer: 10 * 1024 * 1024,
      env: options?.env ?? process.env,
    },
  );
  if (stdout) onLog(stdout.trimEnd());
  if (stderr) onLog(stderr.trimEnd());
  onLog(`${scriptName} finished.`);
}

export async function ensureRepoCloned(
  repoOrUrl: string,
  branch: string,
  clonePath: string,
  onLog: (line: string) => void,
): Promise<void> {
  const url = resolveGitRemoteUrl(repoOrUrl);
  const resolvedPath = resolveClonePath(clonePath);

  if (url.includes("github.com")) {
    await ensureGitCredentialStore();
  }

  prepareCloneTarget(resolvedPath);

  if (!existsSync(resolvedPath) || !isGitCheckout(resolvedPath)) {
    onLog(`Cloning ${url} (branch: ${branch})...`);
    await execGit(["clone", "--branch", branch, url, resolvedPath]);
    onLog("Clone complete.");
    return;
  }

  onLog("Fetching latest changes...");
  await ensureOriginUrl(resolvedPath, url);
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

export function validateBranchName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Branch name is required";
  if (trimmed.includes(" ")) return "Branch name cannot contain spaces";
  if (trimmed.includes("..")) return "Branch name cannot contain ..";
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return "Branch name cannot start or end with /";
  }
  if (trimmed.endsWith(".")) return "Branch name cannot end with .";
  if (trimmed.includes("@{")) return "Invalid branch name";
  if (trimmed.startsWith("-")) return "Branch name cannot start with -";
  return null;
}

async function syncToBaseBranch(
  repo: string,
  baseBranch: string,
  clonePath: string,
  onLog: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  await ensureRepoCloned(repo, baseBranch, clonePath, onLog);

  onLog(`Syncing base branch ${baseBranch}...`);
  await execGit(["fetch", "origin", baseBranch], { cwd: resolvedPath });
  await execGit(["checkout", baseBranch], { cwd: resolvedPath });
  await execGit(["reset", "--hard", `origin/${baseBranch}`], {
    cwd: resolvedPath,
  });
}

export async function createLocalBranchFromBase(
  repo: string,
  baseBranch: string,
  clonePath: string,
  newBranch: string,
  onLog: (line: string) => void,
): Promise<void> {
  const validationError = validateBranchName(newBranch);
  if (validationError) throw new Error(validationError);

  const localBranches = await listLocalBranches(clonePath);
  if (localBranches.includes(newBranch)) {
    throw new Error(`Branch "${newBranch}" already exists`);
  }
  if (newBranch === baseBranch) {
    throw new Error(
      `Cannot create a branch named "${newBranch}" — that is the deploy branch`,
    );
  }

  await syncToBaseBranch(repo, baseBranch, clonePath, onLog);

  onLog(`Creating branch ${newBranch}...`);
  const resolvedPath = resolveClonePath(clonePath);
  await execGit(["checkout", "-b", newBranch], { cwd: resolvedPath });
  onLog(`Branch ${newBranch} ready.`);
}

export async function createBranchFromBase(
  repo: string,
  baseBranch: string,
  clonePath: string,
  newBranch: string,
  onLog: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  await syncToBaseBranch(repo, baseBranch, clonePath, onLog);

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

export async function listAvailableBranches(
  defaultBranch: string,
  clonePath: string,
  options?: { fetchRemote?: boolean },
): Promise<string[]> {
  const resolvedPath = resolveClonePath(clonePath);
  const names = new Set<string>([defaultBranch]);

  if (!existsSync(resolvedPath)) {
    return [defaultBranch];
  }

  if (options?.fetchRemote !== false) {
    try {
      await execGit(["fetch", "--prune", "origin"], { cwd: resolvedPath });
    } catch {
      // Best-effort: still list local branches if fetch fails.
    }
  }

  for (const branch of await listLocalBranches(clonePath)) {
    names.add(branch);
  }

  try {
    const { stdout } = await execGit(
      ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
      { cwd: resolvedPath },
    );
    for (const ref of stdout.trim().split("\n").filter(Boolean)) {
      const name = ref.replace(/^origin\//, "");
      if (name !== "HEAD") names.add(name);
    }
  } catch {
    // Ignore missing remotes.
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

export async function revertAgentBranchWorkspace(
  clonePath: string,
  branch: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) {
    throw new Error("Clone path does not exist");
  }

  const log = onLog ?? (() => {});
  log(`Reverting uncommitted changes on branch ${branch}…`);
  await execGit(["checkout", branch], { cwd: resolvedPath });
  await execGit(["reset", "--hard", "HEAD"], { cwd: resolvedPath });
  await execGit(["clean", "-fd"], { cwd: resolvedPath });
  log("Workspace reverted to last commit on this branch.");
}

export async function hasUncommittedChanges(clonePath: string): Promise<boolean> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) return false;

  const { stdout } = await execGit(["status", "--porcelain"], {
    cwd: resolvedPath,
  });
  return stdout.trim().length > 0;
}

export async function hasUnpushedCommits(
  clonePath: string,
  branch: string,
): Promise<boolean> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) return false;

  try {
    await execGit(["rev-parse", "--verify", `origin/${branch}`], {
      cwd: resolvedPath,
    });
    const { stdout } = await execGit(
      ["rev-list", "--count", `origin/${branch}..${branch}`],
      { cwd: resolvedPath },
    );
    return parseInt(stdout.trim(), 10) > 0;
  } catch {
    return (await getLocalCommitSha(resolvedPath)) !== null;
  }
}

export async function hasRemotePushConflict(
  clonePath: string,
  branch: string,
): Promise<boolean> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) return false;

  try {
    await execGit(["rev-parse", "--verify", `origin/${branch}`], {
      cwd: resolvedPath,
    });
  } catch {
    return false;
  }

  const { stdout } = await execGit(
    ["rev-list", "--left-right", "--count", `origin/${branch}...${branch}`],
    { cwd: resolvedPath },
  );
  const parts = stdout.trim().split(/\s+/);
  if (parts.length !== 2) return false;
  const behind = parseInt(parts[0]!, 10);
  const ahead = parseInt(parts[1]!, 10);
  return behind > 0 && ahead > 0;
}

export function isNonFastForwardPushError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("non-fast-forward") ||
    lower.includes("fetch first") ||
    lower.includes("failed to push some refs")
  );
}

export function buildAgentCommitMessage(initialPrompt: string): string {
  const prompt = initialPrompt.trim();
  const summary = prompt.length > 72 ? `${prompt.slice(0, 72)}…` : prompt;
  return `Agent: ${summary}`;
}

export function gitAuthorIdentity(): { name: string; email: string } {
  const name = process.env.FORGE_GIT_USER_NAME?.trim() || DEFAULT_GIT_USER_NAME;
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

export async function prepareGithubGitAuth(): Promise<void> {
  await ensureGitCredentialStore();
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

export async function pushBranch(
  clonePath: string,
  branch: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  const log = onLog ?? (() => {});

  await ensureGitCredentialStore();

  log(`Pushing ${branch} to origin…`);
  try {
    await execGit(["push", "-u", "origin", branch], { cwd: resolvedPath });
  } catch (err) {
    throw new Error(
      `Failed to push ${branch} to origin: ${formatGitError(err)}`,
    );
  }
  log(`Pushed ${branch} to origin.`);
}

export async function revertAgentSessionCommit(
  clonePath: string,
  branch: string,
  commitSha: string,
  onLog?: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) {
    throw new Error("Clone path does not exist");
  }

  const log = onLog ?? (() => {});
  await execGit(["checkout", branch], { cwd: resolvedPath });

  const headSha = await getLocalCommitSha(resolvedPath);
  if (!headSha) {
    throw new Error("Could not resolve HEAD for revert");
  }
  if (headSha !== commitSha) {
    throw new Error(
      `Branch HEAD (${headSha.slice(0, 7)}) does not match session commit (${commitSha.slice(0, 7)})`,
    );
  }

  log(`Reverting agent commit ${commitSha.slice(0, 7)} on ${branch}…`);
  await execGit(["reset", "--hard", "HEAD~1"], { cwd: resolvedPath });

  await ensureGitCredentialStore();
  log(`Force-pushing reverted ${branch} to origin…`);
  try {
    await execGit(["push", "--force-with-lease", "origin", branch], {
      cwd: resolvedPath,
    });
  } catch (err) {
    throw new Error(
      `Failed to push reverted ${branch} to origin: ${formatGitError(err)}`,
    );
  }
  log(`Reverted and pushed ${branch}.`);
}

/**
 * Ensure the working clone exists and `branch` is a local ref.
 * Used before starting agents (e.g. Add-local projects whose clone lags the
 * bare repo, or Forgefile bootstrap on the deploy branch).
 */
export async function ensureLocalBranchForAgent(
  repo: string,
  defaultBranch: string,
  clonePath: string,
  branch: string,
  onLog: (line: string) => void,
): Promise<void> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch is required");

  const resolvedPath = resolveClonePath(clonePath);
  const cloneBranch =
    trimmed === defaultBranch.trim() ? trimmed : defaultBranch.trim();
  await ensureRepoCloned(repo, cloneBranch || trimmed, clonePath, onLog);

  let locals = await listLocalBranches(clonePath);
  if (locals.includes(trimmed)) return;

  try {
    await execGit(["rev-parse", "--verify", `origin/${trimmed}`], {
      cwd: resolvedPath,
    });
  } catch {
    throw new Error(
      `Branch "${trimmed}" not found locally or on origin. Push the branch to Forge (or create it) first.`,
    );
  }

  onLog(`Creating local branch ${trimmed} from origin/${trimmed}...`);
  await execGit(["checkout", "-B", trimmed, `origin/${trimmed}`], {
    cwd: resolvedPath,
  });

  locals = await listLocalBranches(clonePath);
  if (!locals.includes(trimmed)) {
    throw new Error(
      `Branch "${trimmed}" not found locally or on origin. Push the branch to Forge (or create it) first.`,
    );
  }
}

export async function prepareAgentWorkspace(
  repo: string,
  defaultBranch: string,
  clonePath: string,
  branch: string,
  onLog: (line: string) => void,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  await ensureLocalBranchForAgent(
    repo,
    defaultBranch,
    clonePath,
    branch,
    onLog,
  );

  onLog(`Checking out branch ${branch} (local changes preserved)...`);
  await execGit(["checkout", branch], { cwd: resolvedPath });
  onLog(`Ready on branch ${branch}.`);
}
