import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

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

  if (!existsSync(clonePath)) {
    onLog(`Cloning ${url} (branch: ${branch})...`);
    await execFileAsync("git", ["clone", "--branch", branch, url, clonePath]);
    onLog("Clone complete.");
  } else {
    onLog("Fetching latest changes...");
    await execFileAsync("git", ["fetch", "origin", branch], { cwd: clonePath });
    onLog(`Checking out ${branch}...`);
    await execFileAsync("git", ["checkout", branch], { cwd: clonePath });
    await execFileAsync("git", ["reset", "--hard", `origin/${branch}`], {
      cwd: clonePath,
    });
    onLog("Pull complete.");
  }

  const sha = await getLocalCommitSha(clonePath);
  if (!sha) throw new Error("Failed to resolve local commit after pull");
  return sha;
}

export async function runScript(
  scriptName: string,
  cwd: string,
  onLog: (line: string) => void,
): Promise<void> {
  const scriptPath = `${cwd}/${scriptName}`;
  if (!existsSync(scriptPath)) {
    throw new Error(`${scriptName} not found in repository root`);
  }

  onLog(`Running ./${scriptName}...`);
  const { stdout, stderr } = await execFileAsync("bash", [scriptPath], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stdout) onLog(stdout.trimEnd());
  if (stderr) onLog(stderr.trimEnd());
  onLog(`${scriptName} finished.`);
}
