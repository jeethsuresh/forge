import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import { createForgeGitRepository } from "@/lib/git-repo";
import {
  readComposeStudioState,
  saveComposeOnNewBranch,
} from "@/lib/compose-studio";
import { IMAGE_STARTER_COMPOSE } from "@/lib/git-seed-image-project";

describe("compose studio save", () => {
  let gitRoot: string;
  let reposRoot: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  let createdProjectId: string | null = null;
  let createdRepoId: string | null = null;

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), "forge-compose-bare-"));
    reposRoot = mkdtempSync(join(tmpdir(), "forge-compose-repos-"));
    prevGit = process.env.FORGE_GIT_DIR;
    prevRepos = process.env.FORGE_REPOS_DIR;
    process.env.FORGE_GIT_DIR = gitRoot;
    process.env.FORGE_REPOS_DIR = reposRoot;
  });

  afterEach(() => {
    if (createdProjectId) {
      db.delete(projects).where(eq(projects.id, createdProjectId)).run();
      createdProjectId = null;
    }
    if (createdRepoId) {
      db.delete(gitRepositories).where(eq(gitRepositories.id, createdRepoId)).run();
      createdRepoId = null;
    }
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
    else process.env.FORGE_REPOS_DIR = prevRepos;
    rmSync(gitRoot, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  it("commits compose onto a forge/compose branch without moving main", async () => {
    const unique = `cmp-${Date.now()}`;
    const created = await createForgeGitRepository({
      name: unique,
      slug: unique,
      imageSeed: {
        projectName: unique,
        image: "nginx:latest",
        containerPort: 80,
        hostPort: 3456,
      },
    });
    createdProjectId = created.projectId;
    createdRepoId = created.repositoryId;
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, created.projectId))
      .get();
    expect(project).toBeTruthy();

    const state = readComposeStudioState(project!.clonePath, "main");
    const yaml = `${state.yaml}\n# forge-test-marker\n`;
    const saved = await saveComposeOnNewBranch({
      projectId: created.projectId,
      yaml,
    });
    expect(saved.branch.startsWith("forge/compose-")).toBe(true);

    const mainYaml = execFileSync(
      "git",
      ["show", "origin/main:docker-compose.yml"],
      { cwd: project!.clonePath, encoding: "utf8" },
    );
    expect(mainYaml).not.toContain("forge-test-marker");
    const branchYaml = execFileSync(
      "git",
      ["show", `origin/${saved.branch}:docker-compose.yml`],
      { cwd: project!.clonePath, encoding: "utf8" },
    );
    expect(branchYaml).toContain("forge-test-marker");
  });

  it("can create a starter compose file", async () => {
    const unique = `emptyc-${Date.now()}`;
    const created = await createForgeGitRepository({
      name: unique,
      slug: unique,
    });
    createdProjectId = created.projectId;
    createdRepoId = created.repositoryId;
    const saved = await saveComposeOnNewBranch({
      projectId: created.projectId,
      yaml: IMAGE_STARTER_COMPOSE,
      createIfMissing: true,
    });
    expect(saved.fileName).toBe("docker-compose.yml");
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, created.projectId))
      .get();
    expect(
      readFileSync(join(project!.clonePath, "docker-compose.yml"), "utf8"),
    ).toContain("app:");
  });
});
