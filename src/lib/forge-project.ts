import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, type Project } from "@/lib/db/schema";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { cloneOrPull, parseGithubRepo } from "@/lib/github";

export const FORGE_DISPLAY_NAME = APP_DISPLAY_NAME;

export function forgeSourceDir(): string {
  return process.env.FORGE_SOURCE_DIR ?? "/data/forge-source";
}

export function getForgeRepoConfig(): { repo: string; branch: string } | null {
  const rawRepo = process.env.FORGE_SELF_REPO?.trim();
  if (!rawRepo) return null;
  try {
    return {
      repo: parseGithubRepo(rawRepo),
      branch: process.env.FORGE_SELF_BRANCH?.trim() || "main",
    };
  } catch {
    return null;
  }
}

export function isForgeSelfUpdateConfigured(): boolean {
  return getForgeRepoConfig() !== null;
}

export function findForgeProject(): Project | null {
  const config = getForgeRepoConfig();
  if (!config) return null;

  const rows = db.select().from(projects).all();
  return (
    rows.find((project) => {
      try {
        return parseGithubRepo(project.githubRepo) === config.repo;
      } catch {
        return project.githubRepo.trim() === config.repo;
      }
    }) ?? null
  );
}

export function isForgeProject(project: Project): boolean {
  const forge = findForgeProject();
  return forge?.id === project.id;
}

export function isForgeProjectId(projectId: string): boolean {
  const forge = findForgeProject();
  return forge?.id === projectId;
}

export function ensureForgeProject(): Project | null {
  const config = getForgeRepoConfig();
  if (!config) return null;

  const existing = findForgeProject();
  if (existing) return existing;

  const id = randomUUID();
  const now = new Date();

  db.insert(projects)
    .values({
      id,
      name: FORGE_DISPLAY_NAME,
      githubRepo: config.repo,
      branch: config.branch,
      clonePath: forgeSourceDir(),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

/** Clone or pull the Forge self-repo so agents can edit and deploy like any project. */
export async function ensureForgeSourceRepo(): Promise<Project | null> {
  const project = ensureForgeProject();
  if (!project) return null;

  const config = getForgeRepoConfig();
  if (!config) return project;

  try {
    await cloneOrPull(config.repo, config.branch, forgeSourceDir(), (line) => {
      console.log(`[forge-source] ${line}`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[forge-source] Failed to sync ${config.repo}: ${message}`);
  }

  return project;
}
