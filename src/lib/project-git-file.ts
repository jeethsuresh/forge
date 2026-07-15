import { execFile } from "child_process";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { normalize, resolve } from "path";
import { promisify } from "util";
import {
  parseFileDiffDecorations,
  type ParsedFileDiffDecorations,
} from "@/lib/diff-line-decorations";
import { resolveClonePath } from "@/lib/paths";
import type { ProjectDiffMode } from "@/lib/project-diff-url";
import type { ProjectGitDiffRequest } from "@/lib/project-git-diff";
import { buildProjectGitDiff } from "@/lib/project-git-diff";

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

export type GitFileChangeStatus = "added" | "modified" | "deleted" | "unchanged";

export interface ProjectGitFileResult {
  path: string;
  language: string;
  status: GitFileChangeStatus;
  binary: boolean;
  editable: boolean;
  content: string;
  originalContent: string | null;
  decorations: ParsedFileDiffDecorations;
}

export function assertSafeRepoRelativePath(
  repoRoot: string,
  filePath: string,
): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error("File path is required");
  }

  const normalized = normalize(trimmed).replace(/^\.\/+/, "");
  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error("Invalid file path");
  }

  const absolute = resolve(repoRoot, normalized);
  const repoResolved = resolve(repoRoot);
  if (
    absolute !== repoResolved &&
    !absolute.startsWith(`${repoResolved}/`)
  ) {
    throw new Error("File path escapes repository");
  }

  return normalized;
}

export function languageIdForPath(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";

  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    htm: "html",
    xml: "xml",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    py: "python",
    rs: "rust",
    go: "go",
    sql: "sql",
    toml: "toml",
    dockerfile: "dockerfile",
  };

  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  return map[ext] ?? "plaintext";
}

async function gitShowFile(
  clonePath: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execGit(["show", `${ref}:${filePath}`], {
      cwd: clonePath,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function readWorktreeFile(
  clonePath: string,
  filePath: string,
): Promise<string | null> {
  const absolute = resolve(clonePath, filePath);
  if (!existsSync(absolute)) return null;
  return readFile(absolute, "utf8");
}

function headRefForRequest(
  mode: ProjectDiffMode,
  request: ProjectGitDiffRequest,
): string {
  const watchBranch = request.watchBranch.trim() || "main";

  if (mode === "uncommitted") return "WORKTREE";
  if (mode === "range") {
    const head = request.head?.trim();
    if (!head) throw new Error("head is required");
    return head;
  }
  if (mode === "branch-vs-main") {
    const branch = request.branch?.trim();
    if (!branch) throw new Error("branch is required");
    return branch;
  }
  if (mode === "rebase") {
    const source = request.source?.trim();
    if (!source) throw new Error("source is required");
    return source;
  }
  if (mode === "merge") {
    const source = request.source?.trim();
    if (!source) throw new Error("source is required");
    return source;
  }

  throw new Error(`Unsupported diff mode: ${String(mode)}`);
}

function baseRefForRequest(
  mode: ProjectDiffMode,
  request: ProjectGitDiffRequest,
): string {
  const watchBranch = request.watchBranch.trim() || "main";

  if (mode === "uncommitted") return "HEAD";
  if (mode === "range") {
    const base = request.base?.trim();
    if (!base) throw new Error("base is required");
    return base;
  }
  if (mode === "branch-vs-main") return watchBranch;
  if (mode === "rebase") {
    const onto = request.onto?.trim();
    if (!onto) throw new Error("onto is required");
    return onto;
  }
  if (mode === "merge") {
    const target = request.target?.trim();
    if (!target) throw new Error("target is required");
    return target;
  }

  throw new Error(`Unsupported diff mode: ${String(mode)}`);
}

async function readRefContent(
  clonePath: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  if (ref === "WORKTREE") {
    return readWorktreeFile(clonePath, filePath);
  }
  return gitShowFile(clonePath, ref, filePath);
}

function inferChangeStatus(
  headContent: string | null,
  baseContent: string | null,
): GitFileChangeStatus {
  if (headContent == null && baseContent != null) return "deleted";
  if (headContent != null && baseContent == null) return "added";
  if (headContent !== baseContent) return "modified";
  return "unchanged";
}

export async function readProjectGitFile(
  clonePath: string,
  request: ProjectGitDiffRequest,
  filePath: string,
): Promise<ProjectGitFileResult> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) {
    throw new Error("Clone path does not exist");
  }

  const safePath = assertSafeRepoRelativePath(resolvedPath, filePath);
  const mode = request.mode;
  const headRef = headRefForRequest(mode, request);
  const baseRef = baseRefForRequest(mode, request);

  const diff = await buildProjectGitDiff(resolvedPath, {
    ...request,
    file: safePath,
  });
  const fileStat = diff.files.find((f) => f.path === safePath);
  const binary = fileStat?.binary ?? false;

  if (binary) {
    return {
      path: safePath,
      language: languageIdForPath(safePath),
      status: "modified",
      binary: true,
      editable: false,
      content: "",
      originalContent: null,
      decorations: { lines: [], inlineDeletions: [] },
    };
  }

  const [headContent, baseContent] = await Promise.all([
    readRefContent(resolvedPath, headRef, safePath),
    readRefContent(resolvedPath, baseRef, safePath),
  ]);

  const status = inferChangeStatus(headContent, baseContent);
  const editable = mode === "uncommitted" && status !== "deleted";

  let content = headContent ?? baseContent ?? "";
  if (status === "deleted") {
    content = baseContent ?? "";
  }

  const decorations = parseFileDiffDecorations(
    diff.patch,
    content.split("\n").length,
  );

  return {
    path: safePath,
    language: languageIdForPath(safePath),
    status,
    binary: false,
    editable,
    content,
    originalContent: baseContent,
    decorations,
  };
}

export async function writeProjectGitFile(
  clonePath: string,
  filePath: string,
  content: string,
): Promise<void> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) {
    throw new Error("Clone path does not exist");
  }

  const safePath = assertSafeRepoRelativePath(resolvedPath, filePath);
  const absolute = resolve(resolvedPath, safePath);
  const parent = resolve(absolute, "..");
  const repoResolved = resolve(resolvedPath);
  if (!parent.startsWith(repoResolved) && parent !== repoResolved) {
    throw new Error("File path escapes repository");
  }

  await writeFile(absolute, content, "utf8");
}
