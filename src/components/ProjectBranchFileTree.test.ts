import { describe, expect, it } from "vitest";
import { buildBranchFileTree } from "@/components/ProjectBranchFileTree";

describe("buildBranchFileTree", () => {
  it("nests directories and keeps file status", () => {
    const tree = buildBranchFileTree([
      { path: "src/app.ts", status: "modified" },
      { path: "README.md", status: "unchanged" },
      { path: "src/lib/git.ts", status: "added" },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["src", "README.md"]);
    const src = tree.find((n) => n.name === "src");
    expect(src?.type).toBe("dir");
    expect(src?.children?.some((c) => c.name === "app.ts" && c.status === "modified")).toBe(
      true,
    );
    expect(src?.children?.some((c) => c.name === "lib")).toBe(true);
  });
});
