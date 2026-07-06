import { describe, expect, it } from "vitest";
import { resolveClonePath } from "@/lib/paths";

describe("resolveClonePath", () => {
  it("returns absolute paths unchanged", () => {
    expect(resolveClonePath("/data/repos/foo")).toBe("/data/repos/foo");
  });

  it("remaps data/repos relative paths to FORGE_REPOS_DIR", () => {
    const prev = process.env.FORGE_REPOS_DIR;
    process.env.FORGE_REPOS_DIR = "/data/repos";
    try {
      expect(resolveClonePath("data/repos/jeethsuresh-transport-watcher-main")).toBe(
        "/data/repos/jeethsuresh-transport-watcher-main",
      );
    } finally {
      if (prev === undefined) delete process.env.FORGE_REPOS_DIR;
      else process.env.FORGE_REPOS_DIR = prev;
    }
  });
});
