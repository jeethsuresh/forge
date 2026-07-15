import { describe, expect, it } from "vitest";
import { parseFileDiffDecorations } from "@/lib/diff-line-decorations";

describe("parseFileDiffDecorations", () => {
  it("marks added lines", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "index abc..def 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,3 @@",
      " line1",
      "+added",
      " line2",
    ].join("\n");

    const result = parseFileDiffDecorations(patch, 3);
    expect(result.lines).toEqual([{ line: 2, kind: "added" }]);
    expect(result.inlineDeletions).toEqual([]);
  });

  it("marks modified lines and inline deletions", () => {
    const patch = [
      "@@ -1,3 +1,3 @@",
      "-old",
      "+new",
      " context",
    ].join("\n");

    const result = parseFileDiffDecorations(patch, 2);
    expect(result.lines).toEqual([{ line: 1, kind: "modified" }]);
    expect(result.inlineDeletions).toEqual([
      { beforeLine: 1, text: "old" },
    ]);
  });

  it("shows pure deletions inline before the next line", () => {
    const patch = [
      "@@ -1,2 +1,1 @@",
      "-removed only",
      " kept",
    ].join("\n");

    const result = parseFileDiffDecorations(patch, 1);
    expect(result.lines).toEqual([]);
    expect(result.inlineDeletions).toEqual([
      { beforeLine: 1, text: "removed only" },
    ]);
  });
});
