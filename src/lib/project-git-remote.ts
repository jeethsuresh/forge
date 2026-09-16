import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  gitRepositories,
  type GitRepository,
  type Project,
} from "@/lib/db/schema";
import { forgeGitHttpsUrl } from "@/lib/git-repo";

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
 * Server-side fetch URL. Requires a linked Forge bare repo.
 * GitHub URLs belong only in `github-import` / origin migrate.
 */
export function projectRemoteUrl(project: Project): string {
  const forge = getProjectGitRepository(project);
  if (forge?.barePath) return forge.barePath;
  throw new Error(
    `Project "${project.name}" has no Forge git repository. Import GitHub or attach a Forge origin first.`,
  );
}

/** HTTPS clone URL for agents / external clients. */
export function projectAgentCloneUrl(project: Project): string {
  const forge = getProjectGitRepository(project);
  if (forge) return forgeGitHttpsUrl(forge.slug);
  throw new Error(
    `Project "${project.name}" has no Forge git repository. Import GitHub or attach a Forge origin first.`,
  );
}

export function projectUsesForgeGit(project: Project): boolean {
  return Boolean(getProjectGitRepository(project));
}
