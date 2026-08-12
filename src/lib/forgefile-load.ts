import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseForgefileYaml, type ParseForgefileResult } from "@/lib/forgefile-parse";

export function hashForgefileSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function resolveForgefilePath(repoRoot: string): string | null {
  const forgefilePath = join(repoRoot, "Forgefile");
  const ymlPath = join(repoRoot, "forgefile.yml");
  const hasForgefile = existsSync(forgefilePath);
  const hasYml = existsSync(ymlPath);

  if (hasForgefile && hasYml) {
    const forgefileContent = readFileSync(forgefilePath, "utf8").trim();
    const ymlContent = readFileSync(ymlPath, "utf8").trim();
    if (forgefileContent !== ymlContent) {
      throw new Error("Both Forgefile and forgefile.yml exist with different contents");
    }
    return forgefilePath;
  }

  if (hasForgefile) return forgefilePath;
  if (hasYml) return ymlPath;
  return null;
}

export type LoadedForgefile = {
  path: string;
  source: string;
  contentHash: string;
  parsed: ParseForgefileResult;
};

export function loadForgefile(repoRoot: string): LoadedForgefile {
  const path = resolveForgefilePath(repoRoot);
  if (!path) {
    return {
      path: "",
      source: "",
      contentHash: hashForgefileSource(""),
      parsed: {
        ok: false,
        errors: [{ path: "", message: "Forgefile not found" }],
      },
    };
  }

  const source = readFileSync(path, "utf8");
  const contentHash = hashForgefileSource(source);
  const parsed = parseForgefileYaml(source);

  return { path, source, contentHash, parsed };
}
