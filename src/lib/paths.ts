import { dirname, isAbsolute, join, resolve } from "path";

export function resolveClonePath(clonePath: string): string {
  if (isAbsolute(clonePath)) return clonePath;

  const reposRoot = resolve(process.env.FORGE_REPOS_DIR ?? "./data/repos");
  const normalized = clonePath.replace(/^\.\//, "");

  if (normalized === "data/repos") return reposRoot;
  if (normalized.startsWith("data/repos/")) {
    return join(reposRoot, normalized.slice("data/repos/".length));
  }

  return resolve(clonePath);
}

/** Disk root for artifact blobs: `{dirname(FORGE_DB_PATH)|/data}/artifacts`. */
export function resolveArtifactsRoot(): string {
  const dbPath = process.env.FORGE_DB_PATH ?? "./data/forge.db";
  if (dbPath === ":memory:") {
    return resolve(
      process.env.FORGE_ARTIFACTS_DIR ?? "/tmp/forge-artifacts-test",
    );
  }
  const base = dirname(resolve(dbPath));
  return join(base, "artifacts");
}
