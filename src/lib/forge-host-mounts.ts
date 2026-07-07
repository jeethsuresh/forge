import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface ForgeHostMounts {
  cursorAgentDir: string;
  cursorConfigDir: string;
  updatedAt: string;
}

export function forgeHostMountsPath(): string {
  return process.env.FORGE_HOST_MOUNTS_FILE ?? "/data/forge-host-mounts.json";
}

export function readForgeHostMounts(): ForgeHostMounts | null {
  const path = forgeHostMountsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      cursorAgentDir?: string;
      cursorConfigDir?: string;
      updatedAt?: string;
    };
    const cursorAgentDir = raw.cursorAgentDir?.trim() ?? "";
    const cursorConfigDir = raw.cursorConfigDir?.trim() ?? "";
    if (!cursorAgentDir) return null;
    return {
      cursorAgentDir,
      cursorConfigDir,
      updatedAt: raw.updatedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function writeForgeHostMounts(
  cursorAgentDir: string,
  cursorConfigDir: string,
): void {
  const path = forgeHostMountsPath();
  mkdirSync(dirname(path), { recursive: true });
  const payload: ForgeHostMounts = {
    cursorAgentDir: cursorAgentDir.trim(),
    cursorConfigDir: cursorConfigDir.trim(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Host paths for cursor bind mounts; prefers env, then persisted /data file. */
export function resolveForgeHostMounts(): {
  cursorAgentDir?: string;
  cursorConfigDir?: string;
} {
  const fromEnv = {
    cursorAgentDir: process.env.FORGE_CURSOR_AGENT_DIR?.trim() || undefined,
    cursorConfigDir: process.env.FORGE_CURSOR_CONFIG_DIR?.trim() || undefined,
  };
  if (fromEnv.cursorAgentDir) return fromEnv;

  const persisted = readForgeHostMounts();
  if (!persisted) return fromEnv;

  return {
    cursorAgentDir: persisted.cursorAgentDir,
    cursorConfigDir:
      fromEnv.cursorConfigDir || persisted.cursorConfigDir || undefined,
  };
}
