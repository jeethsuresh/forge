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
      expect(body).toContain("retrying once");
      expect(body).not.toContain("|| true");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("never falls back to forge-git-hook-dev", () => {
    const previousHook = process.env.FORGE_GIT_HOOK_SECRET;
    const previousDb = process.env.FORGE_DB_PATH;
    const previousOps = process.env.FORGE_OPS_SESSION_SECRET;
    try {
      delete process.env.FORGE_GIT_HOOK_SECRET;
      process.env.FORGE_DB_PATH = "/tmp/forge-hook-secret-test.db";
      process.env.FORGE_OPS_SESSION_SECRET = "ops-session-secret";
      expect(resolveGitHookSecret()).toBe("ops-session-secret");
      expect(resolveGitHookSecret()).not.toBe("forge-git-hook-dev");
    } finally {
      if (previousHook === undefined) delete process.env.FORGE_GIT_HOOK_SECRET;
      else process.env.FORGE_GIT_HOOK_SECRET = previousHook;
      if (previousDb === undefined) delete process.env.FORGE_DB_PATH;
      else process.env.FORGE_DB_PATH = previousDb;
      if (previousOps === undefined) delete process.env.FORGE_OPS_SESSION_SECRET;
      else process.env.FORGE_OPS_SESSION_SECRET = previousOps;
    }
  });
});
