import { isAbsolute, join, resolve } from "path";

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
