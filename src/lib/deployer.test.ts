import { describe, expect, it } from "vitest";
import { isAlreadyDeployedCommit } from "@/lib/deployer";

describe("isAlreadyDeployedCommit", () => {
  it("returns true when SHAs match", () => {
    expect(isAlreadyDeployedCommit("abc123", "abc123")).toBe(true);
  });

  it("returns false when SHAs differ", () => {
    expect(isAlreadyDeployedCommit("abc123", "def456")).toBe(false);
  });

  it("returns false when no deployed SHA is recorded", () => {
    expect(isAlreadyDeployedCommit(null, "abc123")).toBe(false);
    expect(isAlreadyDeployedCommit(undefined, "abc123")).toBe(false);
  });
});
