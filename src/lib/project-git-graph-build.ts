import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveClonePath } from "@/lib/paths";
import { shortSha } from "@/lib/utils";
import {
  buildProjectGitTree,
  type GitTreeCommit,
} from "@/lib/project-git-tree";
import {
  branchPathsForColumns,
  GRAPH_PAGE_SIZE,
  type ProjectGitGraph,
} from "@/lib/project-git-graph";

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

function parseCommitLines(stdout: string): GitTreeCommit[] {
  const commits: GitTreeCommit[] = [];
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [sha, parentsRaw, subject, authorDate] = line.split("\0");
    if (!sha) continue;
    commits.push({
      sha,
      shortSha: shortSha(sha),
      subject: subject ?? "",
      authorDate: authorDate ?? "",
      parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
    });
  }
  return commits;
}

async function readUnifiedLogPage(
  clonePath: string,
  skip: number,
  limit: number,
): Promise<GitTreeCommit[]> {
  const { stdout } = await execGit(
    [
      "log",
      "--all",
      "--topo-order",
      `--skip=${skip}`,
      "-n",
      String(limit),
      "--format=%H%x00%P%x00%s%x00%ci",
    ],
    { cwd: clonePath },
  );
  return parseCommitLines(stdout);
}

export async function buildProjectGitGraph(
  clonePath: string,
  watchBranch: string,
  options?: { skip?: number; limit?: number; fetchRemote?: boolean },
): Promise<ProjectGitGraph> {
  const skip = options?.skip ?? 0;
  const limit = options?.limit ?? GRAPH_PAGE_SIZE;
  const resolvedPath = resolveClonePath(clonePath);

  if (!existsSync(resolvedPath)) {
    return {
      columns: [],
      commits: {},
      branches: [],
      branchPaths: {},
      skip,
      limit,
      hasMore: false,
    };
  }

  if (options?.fetchRemote !== false) {
    try {
      await execGit(["fetch", "--prune", "origin"], { cwd: resolvedPath });
    } catch {
      // Best-effort fetch.
    }
  }

  const tree = await buildProjectGitTree(resolvedPath, watchBranch, {
    fetchRemote: false,
  });
  const pageCommits = await readUnifiedLogPage(resolvedPath, skip, limit);
  const probe = await readUnifiedLogPage(resolvedPath, skip + limit, 1);

  const commits: Record<string, GitTreeCommit> = { ...tree.commits };
  for (const commit of pageCommits) {
    commits[commit.sha] = commit;
  }

  const columns = pageCommits.map((commit) => commit.sha);
  const branchPaths = branchPathsForColumns(tree.branches, columns, commits);

  return {
    columns,
    commits,
    branches: tree.branches.map(({ commitShas: _commitShas, ...branch }) => ({
      ...branch,
      commitShas: [],
    })),
    branchPaths,
    skip,
    limit,
    hasMore: probe.length > 0,
  };
}
