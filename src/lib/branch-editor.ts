import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { promisify } from "util";
import { parseFileDiffDecorations } from "@/lib/diff-line-decorations";
import {
  commitAllChanges,
  hasUncommittedChanges,
  pushBranch,
} from "@/lib/git-workspace";
import {
  assertSafeRepoRelativePath,
  languageIdForPath,
  type GitFileChangeStatus,
  type ProjectGitFileResult,
} from "@/lib/project-git-file";

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

export type BranchEditorFileStatus =
  | GitFileChangeStatus
  | "untracked";

export interface BranchEditorFileEntry {
  path: string;
  status: BranchEditorFileStatus;
}

function setStatus(
  map: Map<string, BranchEditorFileStatus>,
  path: string,
  status: BranchEditorFileStatus,
): void {
  if (!path) return;
  if (status === "unchanged" && map.has(path)) return;
  map.set(path, status);
}

async function mergeBaseRef(
  workspacePath: string,
  watchBranch: string,
): Promise<string | null> {
  const watch = watchBranch.trim() || "main";
  const candidates = [`origin/${watch}`, watch];
  for (const candidate of candidates) {
    try {
      const { stdout } = await execGit(
        ["merge-base", "HEAD", candidate],
        { cwd: workspacePath },
      );
      const sha = stdout.trim();
      if (sha) return sha;
    } catch {
      // try next
    }
  }
  return null;
}

function parseNameStatus(stdout: string): Array<{
  path: string;
  status: BranchEditorFileStatus;
}> {
  const rows: Array<{ path: string; status: BranchEditorFileStatus }> = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const match = trimmed.match(/^([AMD])\t(.+)$/);
    if (!match) continue;
    const code = match[1];
    const path = match[2] ?? "";
    const status: BranchEditorFileStatus =
      code === "A" ? "added" : code === "D" ? "deleted" : "modified";
    rows.push({ path, status });
  }
  return rows;
}

function parsePorcelain(stdout: string): Array<{
  path: string;
  status: BranchEditorFileStatus;
}> {
  const rows: Array<{ path: string; status: BranchEditorFileStatus }> = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    const path = rest.includes(" -> ")
      ? rest.slice(rest.lastIndexOf(" -> ") + 4)
      : rest;
    if (xy === "??") {
      rows.push({ path, status: "untracked" });
      continue;
    }
    const letter = xy.includes("D")
      ? "D"
      : xy.includes("A")
        ? "A"
        : xy.includes("M") || xy.includes("U")
          ? "M"
          : "";
    if (letter === "D") rows.push({ path, status: "deleted" });
    else if (letter === "A") rows.push({ path, status: "added" });
    else if (letter === "M") rows.push({ path, status: "modified" });
  }
  return rows;
}

export async function listBranchEditorFiles(
  workspacePath: string,
  watchBranch: string,
): Promise<BranchEditorFileEntry[]> {
  if (!existsSync(workspacePath)) {
    throw new Error("Branch workspace does not exist");
  }

  const map = new Map<string, BranchEditorFileStatus>();

  try {
    const { stdout } = await execGit(
      ["ls-tree", "-r", "--name-only", "HEAD"],
      { cwd: workspacePath },
    );
    for (const path of stdout.split("\n").filter(Boolean)) {
      map.set(path, "unchanged");
    }
  } catch {
    // empty repo
  }

  const base = await mergeBaseRef(workspacePath, watchBranch);
  if (base) {
    try {
      const { stdout } = await execGit(
        ["diff", "--name-status", `${base}..HEAD`],
        { cwd: workspacePath },
      );
      for (const row of parseNameStatus(stdout)) {
        setStatus(map, row.path, row.status);
      }
    } catch {
      // ignore
    }
  }

  try {
    const { stdout } = await execGit(["status", "--porcelain"], {
      cwd: workspacePath,
    });
    for (const row of parsePorcelain(stdout)) {
      setStatus(map, row.path, row.status);
    }
  } catch {
    // ignore
  }

  return [...map.entries()]
    .map(([path, status]) => ({ path, status }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function hasBranchWorkspaceDirty(
  workspacePath: string,
): Promise<boolean> {
  return hasUncommittedChanges(workspacePath);
}

async function gitShowFile(
  workspacePath: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execGit(["show", `${ref}:${filePath}`], {
      cwd: workspacePath,
    });
    return stdout;
  } catch {
    return null;
  }
}

function looksBinary(content: string): boolean {
  return content.includes("\0");
}

export async function readBranchEditorFile(
  workspacePath: string,
  watchBranch: string,
  filePath: string,
): Promise<ProjectGitFileResult> {
  if (!existsSync(workspacePath)) {
    throw new Error("Branch workspace does not exist");
  }
  const safePath = assertSafeRepoRelativePath(workspacePath, filePath);
  const absolute = resolve(workspacePath, safePath);
  const base = (await mergeBaseRef(workspacePath, watchBranch)) ?? "HEAD";

  const originalContent = await gitShowFile(workspacePath, base, safePath);
  let content: string | null = null;
  if (existsSync(absolute)) {
    content = await readFile(absolute, "utf8");
  }

  const files = await listBranchEditorFiles(workspacePath, watchBranch);
  const entry = files.find((file) => file.path === safePath);
  const status: GitFileChangeStatus =
    entry?.status === "untracked"
      ? "added"
      : entry?.status === "deleted"
        ? "deleted"
        : entry?.status === "added"
          ? "added"
          : entry?.status === "modified"
            ? "modified"
            : content == null && originalContent != null
              ? "deleted"
              : content != null && originalContent == null
                ? "added"
                : content !== originalContent
                  ? "modified"
                  : "unchanged";

  if (content != null && looksBinary(content)) {
    return {
      path: safePath,
      language: languageIdForPath(safePath),
      status,
      binary: true,
      editable: false,
      content: "",
      originalContent: null,
      decorations: { lines: [], inlineDeletions: [] },
    };
  }

  if (status === "deleted") {
    content = originalContent ?? "";
  }

  const displayed = content ?? originalContent ?? "";
  let patch = "";
  try {
    const { stdout } = await execGit(
      ["diff", base, "--", safePath],
      { cwd: workspacePath },
    );
    patch = stdout;
  } catch {
    patch = "";
  }

  return {
    path: safePath,
    language: languageIdForPath(safePath),
    status,
    binary: false,
    editable: status !== "deleted",
    content: displayed,
    originalContent,
    decorations: parseFileDiffDecorations(
      patch,
      displayed.split("\n").length,
    ),
  };
}

export async function writeBranchEditorFile(
  workspacePath: string,
  filePath: string,
  content: string,
): Promise<void> {
  if (!existsSync(workspacePath)) {
    throw new Error("Branch workspace does not exist");
  }
  const safePath = assertSafeRepoRelativePath(workspacePath, filePath);
  const absolute = resolve(workspacePath, safePath);
  const parent = dirname(absolute);
  const repoResolved = resolve(workspacePath);
  if (parent !== repoResolved && !parent.startsWith(`${repoResolved}/`)) {
    throw new Error("File path escapes repository");
  }
  await mkdir(parent, { recursive: true });
  await writeFile(absolute, content, "utf8");
}

export async function commitBranchEditorChanges(
  workspacePath: string,
  branch: string,
  message: string,
): Promise<{ committed: boolean; pushed: boolean; commitSha: string | null }> {
  const commitSha = await commitAllChanges(workspacePath, message);
  if (!commitSha) {
    return { committed: false, pushed: false, commitSha: null };
  }
  await pushBranch(workspacePath, branch);
  return { committed: true, pushed: true, commitSha };
}
