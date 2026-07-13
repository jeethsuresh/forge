import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { formatGitError } from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";
import { shortSha } from "@/lib/utils";
import type { ProjectDiffMode } from "@/lib/project-diff-url";

const execFileAsync = promisify(execFile);
const MAX_PATCH_BYTES = 2_000_000;

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

async function execGit(
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { ...options, env: gitEnv() });
}

export interface DiffFileStat {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
}

export interface ProjectGitDiffRequest {
  mode: ProjectDiffMode;
  watchBranch: string;
  base?: string;
  head?: string;
  branch?: string;
  source?: string;
  onto?: string;
  target?: string;
  sessionBranch?: string;
  file?: string;
}

export interface ProjectGitDiffResult {
  mode: ProjectDiffMode;
  label: string;
  baseRef: string | null;
  headRef: string | null;
  baseSha: string | null;
  headSha: string | null;
  files: DiffFileStat[];
  patch: string;
  empty: boolean;
  warning?: string;
  truncated?: boolean;
}

async function resolveRef(clonePath: string, ref: string): Promise<string> {
  try {
    const { stdout } = await execGit(["rev-parse", "--verify", ref], {
      cwd: clonePath,
    });
    return stdout.trim();
  } catch (err) {
    throw new Error(`Unknown ref "${ref}": ${formatGitError(err)}`);
  }
}

async function currentBranch(clonePath: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: clonePath,
    });
    const branch = stdout.trim();
    return branch === "HEAD" ? null : branch;
  } catch {
    return null;
  }
}

function parseNumstat(stdout: string): DiffFileStat[] {
  const files: DiffFileStat[] = [];
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [addRaw, delRaw, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (!path) continue;
    if (addRaw === "-" && delRaw === "-") {
      files.push({ path, insertions: 0, deletions: 0, binary: true });
      continue;
    }
    files.push({
      path,
      insertions: Number.parseInt(addRaw ?? "0", 10) || 0,
      deletions: Number.parseInt(delRaw ?? "0", 10) || 0,
      binary: false,
    });
  }
  return files;
}

async function runDiff(
  clonePath: string,
  range: string,
  file?: string,
): Promise<{ files: DiffFileStat[]; patch: string; truncated: boolean }> {
  const numstatArgs = ["diff", "--numstat", range];
  const patchArgs = ["diff", "--no-color", range];
  if (file) {
    numstatArgs.push("--", file);
    patchArgs.push("--", file);
  }

  const { stdout: numstatOut } = await execGit(numstatArgs, { cwd: clonePath });
  const { stdout: patchOut } = await execGit(patchArgs, { cwd: clonePath });

  const patchBytes = Buffer.byteLength(patchOut, "utf8");
  const truncated = patchBytes > MAX_PATCH_BYTES;
  const patch = truncated
    ? `${patchOut.slice(0, MAX_PATCH_BYTES)}\n\n… diff truncated (${patchBytes.toLocaleString()} bytes total) …`
    : patchOut;

  return {
    files: parseNumstat(numstatOut),
    patch,
    truncated,
  };
}

function formatRefLabel(ref: string, sha: string): string {
  if (/^[0-9a-f]{7,40}$/i.test(ref)) {
    return shortSha(sha);
  }
  return ref;
}

export async function buildProjectGitDiff(
  clonePath: string,
  request: ProjectGitDiffRequest,
): Promise<ProjectGitDiffResult> {
  const resolvedPath = resolveClonePath(clonePath);
  if (!existsSync(resolvedPath)) {
    throw new Error("Clone path does not exist");
  }

  const { mode, watchBranch, file } = request;

  if (mode === "uncommitted") {
    const expectedBranch = request.sessionBranch?.trim();
    const checkedOut = await currentBranch(resolvedPath);
    let warning: string | undefined;

    if (expectedBranch && checkedOut && checkedOut !== expectedBranch) {
      warning = `Workspace is on "${checkedOut}", not "${expectedBranch}". Uncommitted changes apply only to the checked-out branch.`;
    }

    const headSha = await resolveRef(resolvedPath, "HEAD");
    const range = "HEAD";
    const { files, patch, truncated } = await runDiff(resolvedPath, range, file);
    const branchLabel = expectedBranch ?? checkedOut ?? "working tree";

    return {
      mode,
      label: `Uncommitted changes on ${branchLabel}`,
      baseRef: "HEAD",
      headRef: "working tree",
      baseSha: headSha,
      headSha: null,
      files,
      patch,
      empty: files.length === 0 && patch.trim().length === 0,
      warning,
      truncated,
    };
  }

  if (mode === "range") {
    const base = request.base?.trim();
    const head = request.head?.trim();
    if (!base || !head) {
      throw new Error("Both base and head are required for commit range diffs");
    }

    const baseSha = await resolveRef(resolvedPath, base);
    const headSha = await resolveRef(resolvedPath, head);
    const range = `${base}..${head}`;
    const { files, patch, truncated } = await runDiff(resolvedPath, range, file);

    return {
      mode,
      label: `${formatRefLabel(base, baseSha)} → ${formatRefLabel(head, headSha)}`,
      baseRef: base,
      headRef: head,
      baseSha,
      headSha,
      files,
      patch,
      empty: files.length === 0 && patch.trim().length === 0,
      truncated,
    };
  }

  if (mode === "branch-vs-main") {
    const branch = request.branch?.trim();
    if (!branch) {
      throw new Error("branch is required for branch-vs-main diffs");
    }

    const mainRef = watchBranch.trim() || "main";
    const baseSha = await resolveRef(resolvedPath, mainRef);
    const headSha = await resolveRef(resolvedPath, branch);
    const range = `${mainRef}...${branch}`;
    const { files, patch, truncated } = await runDiff(resolvedPath, range, file);

    return {
      mode,
      label: `${branch} vs ${mainRef}`,
      baseRef: mainRef,
      headRef: branch,
      baseSha,
      headSha,
      files,
      patch,
      empty: files.length === 0 && patch.trim().length === 0,
      truncated,
    };
  }

  if (mode === "rebase") {
    const source = request.source?.trim();
    const onto = request.onto?.trim();
    if (!source || !onto) {
      throw new Error("source and onto are required for rebase preview diffs");
    }

    const baseSha = await resolveRef(resolvedPath, onto);
    const headSha = await resolveRef(resolvedPath, source);
    const range = `${onto}...${source}`;
    const { files, patch, truncated } = await runDiff(resolvedPath, range, file);

    return {
      mode,
      label: `Rebase preview: ${source} onto ${onto}`,
      baseRef: onto,
      headRef: source,
      baseSha,
      headSha,
      files,
      patch,
      empty: files.length === 0 && patch.trim().length === 0,
      truncated,
    };
  }

  if (mode === "merge") {
    const source = request.source?.trim();
    const target = request.target?.trim();
    if (!source || !target) {
      throw new Error("source and target are required for merge preview diffs");
    }

    const baseSha = await resolveRef(resolvedPath, target);
    const headSha = await resolveRef(resolvedPath, source);
    const range = `${target}...${source}`;
    const { files, patch, truncated } = await runDiff(resolvedPath, range, file);

    return {
      mode,
      label: `Merge preview: ${source} into ${target}`,
      baseRef: target,
      headRef: source,
      baseSha,
      headSha,
      files,
      patch,
      empty: files.length === 0 && patch.trim().length === 0,
      truncated,
    };
  }

  throw new Error(`Unsupported diff mode: ${String(mode)}`);
}

export function parseProjectDiffMode(value: string | null): ProjectDiffMode | null {
  if (
    value === "uncommitted" ||
    value === "range" ||
    value === "branch-vs-main" ||
    value === "rebase" ||
    value === "merge"
  ) {
    return value;
  }
  return null;
}

export function resolveDiffModeFromParams(params: {
  mode: string | null;
  base: string | null;
  head: string | null;
  branch: string | null;
  source: string | null;
  onto: string | null;
  target: string | null;
  session: string | null;
}): ProjectDiffMode {
  const explicit = parseProjectDiffMode(params.mode);
  if (explicit) return explicit;
  if (params.session) return "uncommitted";
  if (params.source && params.onto) return "rebase";
  if (params.source && params.target) return "merge";
  if (params.branch) return "branch-vs-main";
  if (params.base && params.head) return "range";
  return "uncommitted";
}
