import { describe, expect, it } from "vitest";
import {
  isOlderThanRunningCommit,
  isSameAsPreviousBuild,
  resolveAutoDeployBranch,
} from "@/lib/deployer";

describe("isSameAsPreviousBuild", () => {
  it("returns true when SHAs match", () => {
    expect(isSameAsPreviousBuild("abc123", "abc123")).toBe(true);
  });

  it("returns false when SHAs differ", () => {
    expect(isSameAsPreviousBuild("abc123", "def456")).toBe(false);
  });

  it("returns false when there is no previous build SHA", () => {
    expect(isSameAsPreviousBuild(null, "abc123")).toBe(false);
    expect(isSameAsPreviousBuild(undefined, "abc123")).toBe(false);
  });
});

describe("resolveAutoDeployBranch", () => {
  it("uses the watch branch when there is no previous deployment", () => {
    expect(resolveAutoDeployBranch("main", null)).toBe("main");
    expect(resolveAutoDeployBranch("main", undefined)).toBe("main");
  });

  it("keeps the branch from the latest deployment", () => {
    expect(resolveAutoDeployBranch("main", "release/1.2")).toBe("release/1.2");
  });
});

describe("isOlderThanRunningCommit", () => {
  it("returns false when nothing is running", () => {
    expect(isOlderThanRunningCommit("abc", null, true)).toBe(false);
  });

  it("returns false when the candidate matches the running commit", () => {
    expect(isOlderThanRunningCommit("abc", "abc", true)).toBe(false);
  });

  it("returns true when the candidate is an ancestor of the running commit", () => {
    expect(isOlderThanRunningCommit("older", "newer", true)).toBe(true);
  });

  it("returns false when the candidate is not an ancestor of the running commit", () => {
    expect(isOlderThanRunningCommit("other", "newer", false)).toBe(false);
  });
});
