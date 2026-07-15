import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("isDirectoryWritable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns true for a writable directory", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-src-perm-"));
    const { isDirectoryWritable } = await import(
      "@/lib/forge-source-permissions"
    );
    expect(await isDirectoryWritable(tempDir)).toBe(true);
  });

  it("returns false when the path does not exist", async () => {
    const { isDirectoryWritable } = await import(
      "@/lib/forge-source-permissions"
    );
    expect(
      await isDirectoryWritable(join(tmpdir(), "forge-missing-dir-xyz")),
    ).toBe(false);
  });
});

describe("self-update source permission normalization", () => {
  it("chowns to root under FORGE_RUN_AS_ROOT so keep-id agents can write FETCH_HEAD", () => {
    const script = readFileSync(
      join(process.cwd(), "scripts/self-update.sh"),
      "utf8",
    );
    expect(script).toMatch(
      /normalize_source_permissions\(\)[\s\S]*FORGE_RUN_AS_ROOT[\s\S]*chown -R root:root/,
    );
    expect(script).toMatch(
      /attempt_forge_recovery\(\)[\s\S]*normalize_source_permissions/,
    );
    expect(script).toContain("FETCH_HEAD");
  });
});

describe("ensureForgeSourceWritableForAgents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.FORGE_SOURCE_DIR;
  });

  it("is a no-op when the git dir is already writable", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-src-ok-"));
    mkdirSync(join(tempDir, ".git"));
    writeFileSync(join(tempDir, ".git/HEAD"), "ref: refs/heads/main\n");
    process.env.FORGE_SOURCE_DIR = tempDir;

    const ensureDockerDaemon = vi.fn();
    vi.doMock("@/lib/docker-runtime", () => ({
      dockerExecEnv: () => process.env,
      ensureDockerDaemon,
      forgeDataVolumeName: () => "forge_forge-data",
    }));

    const { ensureForgeSourceWritableForAgents } = await import(
      "@/lib/forge-source-permissions"
    );
    await ensureForgeSourceWritableForAgents();
    expect(ensureDockerDaemon).not.toHaveBeenCalled();
  });
});
