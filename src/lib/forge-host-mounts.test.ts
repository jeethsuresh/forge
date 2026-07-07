import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("forge-host-mounts", () => {
  let tempDir: string;
  let previousPath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "forge-host-mounts-"));
    previousPath = process.env.FORGE_HOST_MOUNTS_FILE;
    process.env.FORGE_HOST_MOUNTS_FILE = join(tempDir, "mounts.json");
  });

  afterEach(() => {
    if (previousPath === undefined) {
      delete process.env.FORGE_HOST_MOUNTS_FILE;
    } else {
      process.env.FORGE_HOST_MOUNTS_FILE = previousPath;
    }
    delete process.env.FORGE_CURSOR_AGENT_DIR;
    delete process.env.FORGE_CURSOR_CONFIG_DIR;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("round-trips cursor host paths", async () => {
    const { writeForgeHostMounts, readForgeHostMounts } = await import(
      "@/lib/forge-host-mounts"
    );
    writeForgeHostMounts(
      "/home/user/.local/share/cursor-agent/versions/1.0.0",
      "/home/user/.config/cursor",
    );
    const mounts = readForgeHostMounts();
    expect(mounts?.cursorAgentDir).toBe(
      "/home/user/.local/share/cursor-agent/versions/1.0.0",
    );
    expect(mounts?.cursorConfigDir).toBe("/home/user/.config/cursor");
    expect(mounts?.updatedAt).toBeTruthy();
  });

  it("resolveForgeHostMounts prefers env over persisted file", async () => {
    const { writeForgeHostMounts, resolveForgeHostMounts } = await import(
      "@/lib/forge-host-mounts"
    );
    writeForgeHostMounts("/persisted/agent", "/persisted/config");
    process.env.FORGE_CURSOR_AGENT_DIR = "/env/agent";
    process.env.FORGE_CURSOR_CONFIG_DIR = "/env/config";
    expect(resolveForgeHostMounts()).toEqual({
      cursorAgentDir: "/env/agent",
      cursorConfigDir: "/env/config",
    });
  });

  it("resolveForgeHostMounts falls back to persisted file", async () => {
    const { writeForgeHostMounts, resolveForgeHostMounts } = await import(
      "@/lib/forge-host-mounts"
    );
    writeForgeHostMounts("/persisted/agent", "/persisted/config");
    expect(resolveForgeHostMounts()).toEqual({
      cursorAgentDir: "/persisted/agent",
      cursorConfigDir: "/persisted/config",
    });
  });
});
