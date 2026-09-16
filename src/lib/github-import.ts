import { promisify } from "util";
import { execFile } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { chmod, writeFile } from "fs/promises";

const execFileAsync = promisify(execFile);

let gitCredentialsConfigured = false;

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
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

export function gitHubCredentials(): {
  username: string;
  password: string;
} | null {
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

/** GitHub.com credential helper — import/migrate only. */
export async function prepareGithubGitAuth(): Promise<void> {
  if (gitCredentialsConfigured) return;

  await execFileAsync("git", ["config", "--global", "--add", "safe.directory", "*"], {
    env: gitEnv(),
  });

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
  await execFileAsync(
    "git",
    ["config", "--global", "credential.helper", `store --file ${credPath}`],
    { env: gitEnv() },
  );
  gitCredentialsConfigured = true;
}
