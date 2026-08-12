import { dirname, join, resolve } from "path";

/** Disk root for bare git repos: `{dirname(FORGE_DB_PATH)|/data}/git`. */
export function resolveGitBareRoot(): string {
  const override = process.env.FORGE_GIT_DIR?.trim();
  if (override) return resolve(override);

  const dbPath = process.env.FORGE_DB_PATH ?? "./data/forge.db";
  if (dbPath === ":memory:") {
    return resolve("/tmp/forge-git-test");
  }
  const base = dirname(resolve(dbPath));
  return join(base, "git");
}

/** Absolute bare repo path for a slug: `<root>/<slug>.git`. */
export function barePathForSlug(slug: string): string {
  const trimmed = slug.trim().replace(/\.git$/i, "");
  if (!trimmed || trimmed.includes("/") || trimmed.includes("..")) {
    throw new Error(`Invalid git repository slug: ${slug}`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) {
    throw new Error(`Invalid git repository slug: ${slug}`);
  }
  return join(resolveGitBareRoot(), `${trimmed}.git`);
}
