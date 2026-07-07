import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  buildRecoveryPrompt,
  findForgeProject,
  isRecoveryPrompt,
  RECOVERY_PROMPT_PREFIX,
} from "@/lib/deploy-recovery";
import { parseGithubRepo } from "@/lib/github";

function deleteProjectsForRepo(repo: string): void {
  for (const row of db.select().from(projects).all()) {
    try {
      if (parseGithubRepo(row.githubRepo) === repo) {
        db.delete(projects).where(eq(projects.id, row.id)).run();
      }
    } catch {
      if (row.githubRepo.trim() === repo) {
        db.delete(projects).where(eq(projects.id, row.id)).run();
      }
    }
  }
}

describe("isRecoveryPrompt", () => {
  it("detects recovery prompts by prefix", () => {
    expect(isRecoveryPrompt(`${RECOVERY_PROMPT_PREFIX} fix build`)).toBe(true);
    expect(isRecoveryPrompt("normal prompt")).toBe(false);
  });
});

describe("buildRecoveryPrompt", () => {
  it("includes branch, error, and recent logs", () => {
    const prompt = buildRecoveryPrompt({
      branch: "main",
      errorMessage: "build failed",
      logs: "line1\nline2",
      kind: "project-deploy",
    });
    expect(prompt).toContain(RECOVERY_PROMPT_PREFIX);
    expect(prompt).toContain("branch main");
    expect(prompt).toContain("build failed");
    expect(prompt).toContain("line2");
  });

  it("labels forge self-update failures", () => {
    const prompt = buildRecoveryPrompt({
      branch: "main",
      errorMessage: "test failed",
      logs: "",
      kind: "forge-self-update",
    });
    expect(prompt).toContain("Forge self-update");
  });
});

describe("findForgeProject", () => {
  const ids: string[] = [];
  let previousRepo: string | undefined;

  beforeEach(() => {
    previousRepo = process.env.FORGE_SELF_REPO;
    deleteProjectsForRepo("acme/forge");
  });

  afterEach(() => {
    for (const id of ids) {
      db.delete(projects).where(eq(projects.id, id)).run();
    }
    ids.length = 0;
    if (previousRepo === undefined) {
      delete process.env.FORGE_SELF_REPO;
    } else {
      process.env.FORGE_SELF_REPO = previousRepo;
    }
  });

  function insertProject(githubRepo: string): string {
    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name: "Forge",
        githubRepo,
        branch: "main",
        clonePath: `/tmp/${id}`,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);
    return id;
  }

  it("returns null when FORGE_SELF_REPO is unset", () => {
    delete process.env.FORGE_SELF_REPO;
    expect(findForgeProject()).toBeNull();
  });

  it("matches project by normalized github repo", () => {
    const id = insertProject("acme/forge");
    process.env.FORGE_SELF_REPO = "https://github.com/acme/forge.git";
    expect(findForgeProject()?.id).toBe(id);
  });
});
