import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  gitRepositories,
  type GitRepository,
  type Project,
} from "@/lib/db/schema";
import { forgeGitHttpsUrl } from "@/lib/git-repo";
import { githubCloneUrl } from "@/lib/github";

export function getProjectGitRepository(
  project: Project,
): GitRepository | null {
  if (!project.gitRepositoryId) return null;
  return (
    db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, project.gitRepositoryId))
      .get() ?? null
  );
}

/**
 * Server-side fetch URL: Forge bare path when linked, else GitHub `owner/repo`
 * (expanded by cloneOrPull / getRemoteCommitSha).
 */
export function projectRemoteUrl(project: Project): string {
  const forge = getProjectGitRepository(project);
  if (forge?.barePath) return forge.barePath;
  if (project.githubRepo?.trim()) return project.githubRepo.trim();
  throw new Error(
    `Project "${project.name}" has no Forge git repository or GitHub origin`,
  );
}

/** HTTPS clone URL for agents / external clients. */
export function projectAgentCloneUrl(project: Project): string {
  const forge = getProjectGitRepository(project);
  if (forge) return forgeGitHttpsUrl(forge.slug);
  if (project.githubRepo?.trim()) {
    return githubCloneUrl(project.githubRepo.trim());
  }
  throw new Error(
    `Project "${project.name}" has no Forge git repository or GitHub origin`,
  );
}

export function projectUsesForgeGit(project: Project): boolean {
  return Boolean(getProjectGitRepository(project));
}
