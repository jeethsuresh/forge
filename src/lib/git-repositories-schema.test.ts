import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";

describe("git_repositories schema", () => {
  it("stores bare repos and links projects via gitRepositoryId", () => {
    const repoId = randomUUID();
    const projectId = randomUUID();
    const now = new Date();

    db.insert(gitRepositories)
      .values({
        id: repoId,
        slug: `schema-test-${repoId.slice(0, 8)}`,
        barePath: `/tmp/forge-git-test/schema-test-${repoId.slice(0, 8)}.git`,
        defaultBranch: "main",
        importedFrom: null,
        createdAt: now,
      })
      .run();

    db.insert(projects)
      .values({
        id: projectId,
        name: `Schema Git ${repoId.slice(0, 8)}`,
        githubRepo: "",
        branch: "main",
        clonePath: `/tmp/clones/${projectId}`,
        gitRepositoryId: repoId,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const repo = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, repoId))
      .get();
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();

    expect(repo?.slug).toContain("schema-test-");
    expect(repo?.importedFrom).toBeNull();
    expect(project?.githubRepo).toBe("");
    expect(project?.gitRepositoryId).toBe(repoId);

    db.delete(projects).where(eq(projects.id, projectId)).run();
    db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
  });
});
