import { cpSync, existsSync, statSync } from "fs";
import { relative, sep } from "path";
import { resolveClonePath } from "@/lib/paths";
import {
  commitAllChanges,
  pushBranch,
} from "@/lib/git-workspace";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function assertAbsoluteHostDirectory(hostPath: string): string {
  const trimmed = hostPath.trim();
  if (!trimmed) {
    throw new Error("Host path is required");
  }
  if (!trimmed.startsWith("/")) {
    throw new Error("Host path must be an absolute directory");
  }
  if (trimmed.includes("\0") || /[\n\r]/.test(trimmed)) {
    throw new Error("Host path is invalid");
  }
  if (!existsSync(trimmed) || !statSync(trimmed).isDirectory()) {
    throw new Error(`Host path is not a directory: ${trimmed}`);
  }
  return trimmed;
}

function skipGitDir(srcRoot: string, source: string): boolean {
  const rel = relative(srcRoot, source);
  if (!rel || rel === ".") return true;
  const parts = rel.split(sep);
  return parts[0] !== ".git";
}

export function copyHostDirectorySkippingGit(
  hostPath: string,
  destDir: string,
): void {
  const src = assertAbsoluteHostDirectory(hostPath);
  cpSync(src, destDir, {
    recursive: true,
    filter: (source) => skipGitDir(src, source),
  });
}

export async function importHostDirectoryToRepo(opts: {
  hostPath: string;
  clonePath: string;
}): Promise<string | null> {
  const dest = resolveClonePath(opts.clonePath);
  copyHostDirectorySkippingGit(opts.hostPath, dest);
  const sha = await commitAllChanges(dest, "chore: import local project files");
  if (!sha) return null;
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: dest, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  );
  await pushBranch(dest, stdout.trim());
  return sha;
}
