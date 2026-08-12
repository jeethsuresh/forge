import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  installPostReceiveHook,
  resolveGitHookSecret,
  gitHookNotifyUrl,
} from "@/lib/git-hooks";

describe("git-hooks", () => {
  it("installs an executable post-receive that posts to Forge", () => {
    const bare = mkdtempSync(join(tmpdir(), "forge-hook-bare-"));
    try {
      const path = installPostReceiveHook(bare, "demo-app");
      expect(existsSync(path)).toBe(true);
      const body = readFileSync(path, "utf8");
      expect(body).toContain("#!/bin/sh");
      expect(body).toContain("demo-app");
      expect(body).toContain(gitHookNotifyUrl());
      expect(body).toContain(resolveGitHookSecret());
      expect(body).toContain("X-Forge-Git-Hook-Secret");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
