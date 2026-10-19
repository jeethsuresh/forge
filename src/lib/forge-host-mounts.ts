import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface ForgeHostMounts {
  cursorAgentDir: string;
  cursorConfigDir: string;
  codexDir: string;
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
      codexDir?: string;
      updatedAt?: string;
    };
    const cursorAgentDir = raw.cursorAgentDir?.trim() ?? "";
    const cursorConfigDir = raw.cursorConfigDir?.trim() ?? "";
    const codexDir = raw.codexDir?.trim() ?? "";
    if (!cursorAgentDir && !codexDir) return null;
    return {
      cursorAgentDir,
      cursorConfigDir,
      codexDir,
      updatedAt: raw.updatedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function writeForgeHostMounts(
  cursorAgentDir: string,
  cursorConfigDir: string,
  codexDir = "",
): void {
  const path = forgeHostMountsPath();
  mkdirSync(dirname(path), { recursive: true });
  const payload: ForgeHostMounts = {
    cursorAgentDir: cursorAgentDir.trim(),
    cursorConfigDir: cursorConfigDir.trim(),
    codexDir: codexDir.trim(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Host paths for agent CLI binds; prefers env, then persisted /data file. */
export function resolveForgeHostMounts(): {
  cursorAgentDir?: string;
  cursorConfigDir?: string;
  codexDir?: string;
} {
  const persisted = readForgeHostMounts();
  const fromEnv = {
    cursorAgentDir: process.env.FORGE_CURSOR_AGENT_DIR?.trim() || undefined,
    cursorConfigDir: process.env.FORGE_CURSOR_CONFIG_DIR?.trim() || undefined,
    codexDir: process.env.FORGE_CODEX_DIR?.trim() || undefined,
  };
  return {
    cursorAgentDir: fromEnv.cursorAgentDir || persisted?.cursorAgentDir || undefined,
    cursorConfigDir:
      fromEnv.cursorConfigDir || persisted?.cursorConfigDir || undefined,
    codexDir: fromEnv.codexDir || persisted?.codexDir || undefined,
  };
}
