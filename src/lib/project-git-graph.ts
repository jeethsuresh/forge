import type { GitTreeBranch, GitTreeCommit } from "@/lib/project-git-tree";

export const GRAPH_PAGE_SIZE = 20;

export interface ProjectGitGraph {
  columns: string[];
  commits: Record<string, GitTreeCommit>;
  branches: GitTreeBranch[];
  branchPaths: Record<string, string[]>;
  skip: number;
  limit: number;
  hasMore: boolean;
}

export function ancestorsWithinLoaded(
  headSha: string,
  loaded: Set<string>,
  commits: Record<string, GitTreeCommit>,
): Set<string> {
  const result = new Set<string>();
  const stack = [headSha];
  while (stack.length > 0) {
    const sha = stack.pop();
    if (!sha || !loaded.has(sha) || result.has(sha)) continue;
    result.add(sha);
    const commit = commits[sha];
    if (!commit) continue;
    for (const parent of commit.parents) {
      stack.push(parent);
    }
  }
  return result;
}

export function branchPathsForColumns(
  branches: GitTreeBranch[],
  columns: string[],
  commits: Record<string, GitTreeCommit>,
): Record<string, string[]> {
  const loaded = new Set(columns);
  const paths: Record<string, string[]> = {};
  for (const branch of branches) {
    if (!branch.headSha) {
      paths[branch.name] = [];
      continue;
    }
    const ancestors = ancestorsWithinLoaded(branch.headSha, loaded, commits);
    paths[branch.name] = columns.filter((sha) => ancestors.has(sha));
  }
  return paths;
}

export function mergeGitGraphPages(
  existing: ProjectGitGraph,
  page: ProjectGitGraph,
): ProjectGitGraph {
  const seen = new Set(existing.columns);
  const appendedColumns = page.columns.filter((sha) => !seen.has(sha));
  const columns = [...existing.columns, ...appendedColumns];
  const commits = { ...existing.commits, ...page.commits };
  const branchPaths = branchPathsForColumns(page.branches, columns, commits);

  return {
    columns,
    commits,
    branches: page.branches,
    branchPaths,
    skip: page.skip,
    limit: page.limit,
    hasMore: page.hasMore,
  };
}
