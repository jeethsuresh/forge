import { afterEach, describe, expect, it } from "vitest";
import { barePathForSlug, resolveGitBareRoot } from "@/lib/git-paths";

describe("resolveGitBareRoot", () => {
  const prevGit = process.env.FORGE_GIT_DIR;
  const prevDb = process.env.FORGE_DB_PATH;

  afterEach(() => {
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevDb === undefined) delete process.env.FORGE_DB_PATH;
    else process.env.FORGE_DB_PATH = prevDb;
  });

  it("uses FORGE_GIT_DIR when set", () => {
    process.env.FORGE_GIT_DIR = "/data/git";
    expect(resolveGitBareRoot()).toBe("/data/git");
  });

  it("derives from FORGE_DB_PATH dirname", () => {
    delete process.env.FORGE_GIT_DIR;
    process.env.FORGE_DB_PATH = "/var/lib/forge/forge.db";
    expect(resolveGitBareRoot()).toBe("/var/lib/forge/git");
  });

  it("uses a temp root for in-memory DB", () => {
    delete process.env.FORGE_GIT_DIR;
    process.env.FORGE_DB_PATH = ":memory:";
    expect(resolveGitBareRoot()).toBe("/tmp/forge-git-test");
  });
});

describe("barePathForSlug", () => {
  const prevGit = process.env.FORGE_GIT_DIR;

  afterEach(() => {
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
  });

  it("appends .git under the bare root", () => {
    process.env.FORGE_GIT_DIR = "/data/git";
    expect(barePathForSlug("my-app")).toBe("/data/git/my-app.git");
  });

  it("strips a trailing .git from the slug", () => {
    process.env.FORGE_GIT_DIR = "/data/git";
    expect(barePathForSlug("my-app.git")).toBe("/data/git/my-app.git");
  });

  it("rejects path traversal and empty slugs", () => {
    process.env.FORGE_GIT_DIR = "/data/git";
    expect(() => barePathForSlug("../evil")).toThrow(/Invalid/);
    expect(() => barePathForSlug("")).toThrow(/Invalid/);
    expect(() => barePathForSlug("a/b")).toThrow(/Invalid/);
  });
});
