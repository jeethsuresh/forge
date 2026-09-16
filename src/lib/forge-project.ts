import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, type Project } from "@/lib/db/schema";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { cloneOrPull } from "@/lib/git-workspace";
import { parseGithubRepo } from "@/lib/github-import";
import { projectRemoteUrl } from "@/lib/project-git-remote";

export const FORGE_DISPLAY_NAME = APP_DISPLAY_NAME;

export function forgeSourceDir(): string {
  return process.env.FORGE_SOURCE_DIR ?? "/data/forge-source";
}

function leftoverGithubRepo(): string | null {
  const rawRepo = process.env.FORGE_SELF_REPO?.trim();
  if (!rawRepo) return null;
  try {
    return parseGithubRepo(rawRepo);
  } catch {
    return rawRepo;
  }
}

export function getForgeRepoConfig(): { repo: string; branch: string } | null {
  const project = findForgeProject();
  if (project) {
    return {
      repo: project.githubRepo || leftoverGithubRepo() || project.name,
      branch: process.env.FORGE_SELF_BRANCH?.trim() || project.branch || "main",
    };
  }
  const leftover = leftoverGithubRepo();
  if (!leftover) return null;
  return {
    repo: leftover,
    branch: process.env.FORGE_SELF_BRANCH?.trim() || "main",
  };
}

export function isForgeSelfUpdateConfigured(): boolean {
  return findForgeProject() !== null || leftoverGithubRepo() !== null;
}

export function findForgeProject(): Project | null {
  const rows = db.select().from(projects).all();
  const sourceDir = forgeSourceDir();
  const byPath = rows.find((project) => project.clonePath === sourceDir);
  if (byPath) return byPath;

  const byName = rows.find((project) => project.name === FORGE_DISPLAY_NAME);
  if (byName) return byName;

  const leftover = leftoverGithubRepo();
  if (leftover) {
    return (
      rows.find((project) => {
        try {
          return parseGithubRepo(project.githubRepo) === leftover;
        } catch {
          return project.githubRepo.trim() === leftover;
        }
      }) ?? null
    );
  }

  return null;
}

export function isForgeProject(project: Project): boolean {
  if (project.clonePath === forgeSourceDir()) return true;
  const forge = findForgeProject();
  return forge?.id === project.id;
}

export function isForgeProjectId(projectId: string): boolean {
  const forge = findForgeProject();
  return forge?.id === projectId;
}

export function ensureForgeProject(): Project | null {
  const existing = findForgeProject();
  if (existing) return existing;

  const leftover = leftoverGithubRepo();
  if (!leftover) return null;

  const id = randomUUID();
  const now = new Date();
  const branch = process.env.FORGE_SELF_BRANCH?.trim() || "main";

  db.insert(projects)
    .values({
      id,
      name: FORGE_DISPLAY_NAME,
      githubRepo: leftover,
      branch,
      clonePath: forgeSourceDir(),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

/** Clone or pull Forge from its Forge git origin (or leftover GitHub URL during migrate). */
export async function ensureForgeSourceRepo(): Promise<Project | null> {
  const project = ensureForgeProject();
  if (!project) return null;

  let remote: string;
  try {
    remote = projectRemoteUrl(project);
  } catch {
    const leftover = leftoverGithubRepo();
    if (!leftover) return project;
    remote = leftover;
  }

  try {
    await cloneOrPull(remote, project.branch, forgeSourceDir(), (line) => {
      console.log(`[forge-source] ${line}`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[forge-source] Failed to sync ${remote}: ${message}`);
  }

  return project;
}
