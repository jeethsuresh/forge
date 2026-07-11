import { describe, expect, it } from "vitest";
import {
  ancestorsWithinLoaded,
  branchPathsForColumns,
  mergeGitGraphPages,
  type ProjectGitGraph,
} from "@/lib/project-git-graph";
import type { GitTreeBranch, GitTreeCommit } from "@/lib/project-git-tree";

function commit(
  sha: string,
  parents: string[],
  subject = sha,
): GitTreeCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    subject,
    authorDate: "2026-01-01 00:00:00 +0000",
    parents,
  };
}

function branchMeta(name: string, headSha: string): GitTreeBranch {
  return {
    name,
    headSha,
    commitShas: [],
    isLocal: true,
    hasRemote: true,
    unpushed: false,
    isWatchBranch: name === "main",
  };
}

describe("ancestorsWithinLoaded", () => {
  it("walks parents only within the loaded set", () => {
    const commits: Record<string, GitTreeCommit> = {
      a: commit("a", ["b"]),
      b: commit("b", ["c"]),
      c: commit("c", []),
    };
    const loaded = new Set(["a", "b"]);
    expect(ancestorsWithinLoaded("a", loaded, commits)).toEqual(
      new Set(["a", "b"]),
    );
  });
});

describe("branchPathsForColumns", () => {
  it("maps each branch through shared and unique commits", () => {
    const columns = ["tip-f", "shared", "root"];
    const commits: Record<string, GitTreeCommit> = {
      "tip-f": commit("tip-f", ["shared"]),
      shared: commit("shared", ["root"]),
      root: commit("root", []),
    };
    const branches = [branchMeta("main", "shared"), branchMeta("feature", "tip-f")];
    const paths = branchPathsForColumns(branches, columns, commits);

    expect(paths.main).toEqual(["shared", "root"]);
    expect(paths.feature).toEqual(["tip-f", "shared", "root"]);
  });
});

describe("mergeGitGraphPages", () => {
  it("appends older columns without duplicates", () => {
    const existing: ProjectGitGraph = {
      columns: ["a", "b"],
      commits: {
        a: commit("a", ["b"]),
        b: commit("b", []),
      },
      branches: [branchMeta("main", "a")],
      branchPaths: { main: ["a", "b"] },
      skip: 0,
      limit: 2,
      hasMore: true,
    };
    const page: ProjectGitGraph = {
      columns: ["b", "c"],
      commits: {
        b: commit("b", ["c"]),
        c: commit("c", []),
      },
      branches: [branchMeta("main", "a")],
      branchPaths: { main: ["b", "c"] },
      skip: 2,
      limit: 2,
      hasMore: false,
    };

    const merged = mergeGitGraphPages(existing, page);
    expect(merged.columns).toEqual(["a", "b", "c"]);
    expect(merged.hasMore).toBe(false);
    expect(merged.branchPaths.main).toEqual(["a", "b", "c"]);
  });
});
