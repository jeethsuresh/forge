import { describe, expect, it } from "vitest";
import type { ProjectGitGraph } from "@/lib/project-git-graph";
import {
  buildGraphLayout,
  LANE_HEIGHT,
} from "@/lib/project-git-graph-layout";

function sampleGraph(): ProjectGitGraph {
  return {
    columns: ["c2", "c1", "c0"],
    commits: {
      c0: {
        sha: "c0",
        shortSha: "c0",
        subject: "root",
        authorDate: "",
        parents: [],
      },
      c1: {
        sha: "c1",
        shortSha: "c1",
        subject: "main tip",
        authorDate: "",
        parents: ["c0"],
      },
      c2: {
        sha: "c2",
        shortSha: "c2",
        subject: "agent tip",
        authorDate: "",
        parents: ["c1"],
      },
    },
    branches: [
      {
        name: "main",
        headSha: "c1",
        isWatchBranch: true,
        unpushed: false,
        remoteConflict: false,
        isLocal: true,
        hasRemote: true,
        commitShas: [],
      },
      {
        name: "agent/feature",
        headSha: "c2",
        isWatchBranch: false,
        unpushed: true,
        remoteConflict: false,
        isLocal: true,
        hasRemote: false,
        commitShas: [],
      },
    ],
    branchPaths: {
      main: ["c1", "c0"],
      "agent/feature": ["c2", "c1", "c0"],
    },
    skip: 0,
    limit: 20,
    hasMore: false,
  };
}

describe("buildGraphLayout", () => {
  it("places commits on their primary branch lane so rows align", () => {
    const layout = buildGraphLayout(sampleGraph());
    expect(layout.laneByBranch.main).toBe(0);
    expect(layout.laneByBranch["agent/feature"]).toBe(1);

    const c2 = layout.nodes.find((n) => n.sha === "c2");
    const c1 = layout.nodes.find((n) => n.sha === "c1");
    expect(c2?.lane).toBe(1);
    // Shared commit prefers the lowest lane (main).
    expect(c1?.lane).toBe(0);
    expect(c2?.y).toBe(c1!.y + LANE_HEIGHT);
  });

  it("adds a dashed merge preview edge between heads", () => {
    const layout = buildGraphLayout(sampleGraph(), {
      kind: "merge",
      source: "agent/feature",
      target: "main",
    });
    const preview = layout.tracks.find((t) => t.dashed);
    expect(preview?.path).toContain("M ");
    expect(preview?.path).toContain(" L ");
  });

  it("adds a dashed rebase preview path from onto head", () => {
    const layout = buildGraphLayout(sampleGraph(), {
      kind: "rebase",
      source: "agent/feature",
      onto: "main",
    });
    const preview = layout.tracks.find((t) => t.dashed);
    expect(preview).toBeDefined();
    expect(preview?.path.length).toBeGreaterThan(0);
  });
});
