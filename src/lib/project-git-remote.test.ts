import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import { createForgeGitRepository } from "@/lib/git-repo";
import {
  projectAgentCloneUrl,
  projectRemoteUrl,
  projectUsesForgeGit,
} from "@/lib/project-git-remote";

describe("project-git-remote", () => {
  it("prefers Forge bare path and HTTPS clone URL when linked", async () => {
    const gitRoot = mkdtempSync(join(tmpdir(), "forge-remote-"));
    const reposRoot = mkdtempSync(join(tmpdir(), "forge-remote-repos-"));
    const prevGit = process.env.FORGE_GIT_DIR;
    const prevRepos = process.env.FORGE_REPOS_DIR;
    process.env.FORGE_GIT_DIR = gitRoot;
    process.env.FORGE_REPOS_DIR = reposRoot;

    const slug = `remote-${Date.now()}`;
    let projectId = "";
    let repoId = "";
    try {
      const created = await createForgeGitRepository({ name: slug, slug });
      projectId = created.projectId;
      repoId = created.repositoryId;
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .get()!;

      expect(projectUsesForgeGit(project)).toBe(true);
      expect(projectRemoteUrl(project)).toBe(created.barePath);
      expect(projectAgentCloneUrl(project)).toContain(
        `/api/git/${slug}.git`,
      );
    } finally {
      if (projectId) {
        db.delete(projects).where(eq(projects.id, projectId)).run();
      }
      if (repoId) {
        db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
      }
      if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
      else process.env.FORGE_GIT_DIR = prevGit;
      if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
      else process.env.FORGE_REPOS_DIR = prevRepos;
      rmSync(gitRoot, { recursive: true, force: true });
      rmSync(reposRoot, { recursive: true, force: true });
    }
  });
});
