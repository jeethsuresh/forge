import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  projectImageName,
  projectSupportsRollback,
  readProjectReleaseState,
  releaseStatePath,
  resolveHealthPath,
  resolveStagingPort,
  saveProjectReleaseState,
  stagingProjectName,
} from "@/lib/deploy-rollback";
import { isForgeProject } from "@/lib/forge-project";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

describe("deploy-rollback helpers", () => {
  const ids: string[] = [];
  let previousRepo: string | undefined;

  beforeEach(() => {
    previousRepo = process.env.FORGE_SELF_REPO;
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

  function insertProject(name: string, clonePath: string, githubRepo = "acme/app") {
    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name,
        githubRepo,
        branch: "main",
        clonePath,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);
    return db.select().from(projects).where(eq(projects.id, id)).get()!;
  }

  it("uses forge-app image name for the Orchestrator project", () => {
    process.env.FORGE_SELF_REPO = "acme/forge";
    const forge = insertProject(APP_DISPLAY_NAME, "/data/forge-source", "acme/forge");
    expect(isForgeProject(forge)).toBe(true);
    expect(projectImageName(forge)).toBe("forge-app");
    expect(resolveHealthPath(forge)).toBe("/api/forge/health");
  });

  it("derives per-project image names and staging compose projects", () => {
    const project = insertProject("My App", "/tmp/my-app");
    expect(projectImageName(project)).toBe("my-app-app");
    expect(stagingProjectName("my-app")).toBe("my-app-staging");
    expect(resolveHealthPath(project)).toBe("/");
    expect(projectSupportsRollback(project)).toBe(false);
  });

  it("persists release state per project", () => {
    const project = insertProject("State Test", "/tmp/state");
    const path = releaseStatePath(project.id);
    expect(path).toContain(project.id);

    saveProjectReleaseState(project.id, "abc123");
    const state = readProjectReleaseState(project.id);
    expect(state?.stableCommitSha).toBe("abc123");
  });

  it("picks a staging port from HOST_PORT when STAGING_PORT is unset", () => {
    expect(resolveStagingPort({ HOST_PORT: "3000" })).toBe("3466");
    expect(resolveStagingPort({ STAGING_PORT: "3999", HOST_PORT: "3000" })).toBe(
      "3999",
    );
  });
});
