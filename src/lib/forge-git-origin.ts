import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

/** Forge smart HTTP clone URL (no embedded userinfo). */
export function isForgeHttpGitUrl(url: string): boolean {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.pathname.includes("/api/git/");
  } catch {
    return false;
  }
}

/**
 * Point `origin` at the local bare repo so Forge can fetch and push branches
 * without an HTTP username prompt.
 */
export async function ensureForgeBareOrigin(
  cwd: string,
  barePath: string,
): Promise<void> {
  const target = barePath.trim();
  if (!target || target.includes("://")) return;

  let current = "";
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd,
      env: gitEnv(),
    });
    current = stdout.trim();
  } catch {
    await execFileAsync("git", ["remote", "add", "origin", target], {
      cwd,
      env: gitEnv(),
    });
    return;
  }

  if (current === target) return;
  if (!isForgeHttpGitUrl(current)) return;

  await execFileAsync("git", ["remote", "set-url", "origin", target], {
    cwd,
    env: gitEnv(),
  });
}
