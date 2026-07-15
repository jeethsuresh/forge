import { describe, expect, it } from "vitest";
import {
  extractCommitShaFromEnv,
  extractCommitShaFromImageRef,
  normalizeCommitShaCandidate,
} from "@/lib/project-running-sha";

describe("project-running-sha helpers", () => {
  it("normalizes valid SHA candidates", () => {
    expect(normalizeCommitShaCandidate("Abc1234")).toBe("abc1234");
    expect(normalizeCommitShaCandidate("deadbeefcafe")).toBe("deadbeefcafe");
    expect(normalizeCommitShaCandidate("sha-abcdef0")).toBe("abcdef0");
    expect(normalizeCommitShaCandidate("next")).toBeNull();
    expect(normalizeCommitShaCandidate("stable")).toBeNull();
    expect(normalizeCommitShaCandidate("abc123")).toBeNull();
  });

  it("extracts SHAs from image refs and env", () => {
    expect(
      extractCommitShaFromImageRef(
        "localhost/forge-app:68a6861bac03096fde962b4a91a19d9702461a94",
      ),
    ).toBe("68a6861bac03096fde962b4a91a19d9702461a94");
    expect(extractCommitShaFromImageRef("forge-app:stable")).toBeNull();
    expect(
      extractCommitShaFromEnv([
        "PATH=/usr/bin",
        "FORGE_COMMIT_SHA=AbcDef0123456789",
        "SOURCE_SHA=ignored",
      ]),
    ).toBe("abcdef0123456789");
    expect(
      extractCommitShaFromEnv(["SOURCE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]),
    ).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  });
});
