import { describe, expect, it } from "vitest";
import {
  agentSessionUncommittedDiffHref,
  branchVsMainDiffHref,
  buildProjectDiffHref,
  commitRangeDiffHref,
} from "./project-diff-url";

describe("buildProjectDiffHref", () => {
  it("stays on the changes intent route", () => {
    expect(buildProjectDiffHref("p1", {})).toBe("/projects/p1/changes");
    expect(buildProjectDiffHref("p1", { mode: "branch-vs-main", branch: "feat" })).toBe(
      "/projects/p1/changes?mode=branch-vs-main&branch=feat",
    );
  });

  it("builds session and range links on /changes", () => {
    expect(agentSessionUncommittedDiffHref("p1", "s1")).toBe(
      "/projects/p1/changes?mode=uncommitted&session=s1",
    );
    expect(branchVsMainDiffHref("p1", "main")).toBe(
      "/projects/p1/changes?mode=branch-vs-main&branch=main",
    );
    expect(commitRangeDiffHref("p1", "abc", "def")).toBe(
      "/projects/p1/changes?mode=range&base=abc&head=def",
    );
  });
});
