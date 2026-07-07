import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, type Project } from "@/lib/db/schema";
import { parseGithubRepo } from "@/lib/github";

export const FORGE_DISPLAY_NAME = "Forge";

function forgeSourceDir(): string {
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
