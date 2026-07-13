import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  ensureForgeProject,
  findForgeProject,
  FORGE_DISPLAY_NAME,
  getForgeRepoConfig,
  isForgeProject,
  isForgeSelfUpdateConfigured,
} from "@/lib/forge-project";

describe("forge-project", () => {
  const ids: string[] = [];
  let previousRepo: string | undefined;
  let previousBranch: string | undefined;
  let previousSourceDir: string | undefined;

  beforeEach(() => {
    previousRepo = process.env.FORGE_SELF_REPO;
    previousBranch = process.env.FORGE_SELF_BRANCH;
    previousSourceDir = process.env.FORGE_SOURCE_DIR;
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
    if (previousBranch === undefined) {
      delete process.env.FORGE_SELF_BRANCH;
    } else {
      process.env.FORGE_SELF_BRANCH = previousBranch;
    }
    if (previousSourceDir === undefined) {
      delete process.env.FORGE_SOURCE_DIR;
    } else {
      process.env.FORGE_SOURCE_DIR = previousSourceDir;
    }
  });

  it("reports unconfigured when FORGE_SELF_REPO is missing", () => {
    delete process.env.FORGE_SELF_REPO;
    expect(isForgeSelfUpdateConfigured()).toBe(false);
    expect(getForgeRepoConfig()).toBeNull();
    expect(ensureForgeProject()).toBeNull();
  });

  it("creates and reuses the Forge project row", () => {
    process.env.FORGE_SELF_REPO = "acme/forge";
    process.env.FORGE_SELF_BRANCH = "main";

    const created = ensureForgeProject();
    expect(created).not.toBeNull();
    expect(created?.name).toBe(FORGE_DISPLAY_NAME);
    expect(created?.githubRepo).toBe("acme/forge");
    if (created) ids.push(created.id);

    const again = ensureForgeProject();
    expect(again?.id).toBe(created?.id);
    expect(isForgeProject(created!)).toBe(true);
    expect(findForgeProject()?.id).toBe(created?.id);
  });

  it("matches existing projects by normalized repo", () => {
    process.env.FORGE_SELF_REPO = "https://github.com/acme/forge.git";

    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name: "Existing Forge",
        githubRepo: "acme/forge",
        branch: "main",
        clonePath: "/tmp/forge",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);

    const ensured = ensureForgeProject();
    expect(ensured?.id).toBe(id);
  });

  it("finds Forge by clone path when FORGE_SELF_REPO is missing", () => {
    delete process.env.FORGE_SELF_REPO;
    const id = randomUUID();
    const now = new Date();
    const sourceDir = "/data/forge-source";
    process.env.FORGE_SOURCE_DIR = sourceDir;
    db.insert(projects)
      .values({
        id,
        name: FORGE_DISPLAY_NAME,
        githubRepo: "acme/forge",
        branch: "main",
        clonePath: sourceDir,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);

    const found = findForgeProject();
    expect(found?.id).toBe(id);
    expect(isForgeProject(found!)).toBe(true);
  });
});
