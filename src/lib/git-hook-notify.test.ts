import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { execFileSync } from "child_process";
import { db } from "@/lib/db";
import {
  gitRepositories,
  projectForgefiles,
  projects,
} from "@/lib/db/schema";
import { createForgeGitRepository } from "@/lib/git-repo";
import {
  processPostReceiveNotify,
  verifyGitHookSecret,
} from "@/lib/git-hook-notify";
import { resolveGitHookSecret } from "@/lib/git-hooks";
import { buildSeedForgefile } from "@/lib/git-seed-forgefile";

describe("verifyGitHookSecret", () => {
  it("accepts the configured secret", () => {
    expect(verifyGitHookSecret(resolveGitHookSecret())).toBe(true);
    expect(verifyGitHookSecret("wrong")).toBe(false);
    expect(verifyGitHookSecret(null)).toBe(false);
  });
});

describe("processPostReceiveNotify", () => {
  let gitRoot: string;
  let reposRoot: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  let projectId = "";
  let repoId = "";
  let slug = "";
  let barePath = "";

  beforeEach(async () => {
    gitRoot = mkdtempSync(join(tmpdir(), "forge-hook-git-"));
    reposRoot = mkdtempSync(join(tmpdir(), "forge-hook-repos-"));
    prevGit = process.env.FORGE_GIT_DIR;
    prevRepos = process.env.FORGE_REPOS_DIR;
    process.env.FORGE_GIT_DIR = gitRoot;
    process.env.FORGE_REPOS_DIR = reposRoot;

    slug = `hook-${Date.now()}`;
    const created = await createForgeGitRepository({
      name: slug,
      slug,
    });
    projectId = created.projectId;
    repoId = created.repositoryId;
    barePath = created.barePath;
  });

  afterEach(() => {
    db.delete(projectForgefiles)
      .where(eq(projectForgefiles.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
    else process.env.FORGE_REPOS_DIR = prevRepos;
    rmSync(gitRoot, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  it("refreshes working clone and projects Forgefile on push", async () => {
    const work = mkdtempSync(join(tmpdir(), "forge-hook-push-"));
    try {
      execFileSync("git", ["clone", barePath, work], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      // Enable auto_deploy on seed forgefile for target listing
      const ff = buildSeedForgefile(slug).replace(
        "auto_deploy: false",
        "auto_deploy: true",
      );
      writeFileSync(join(work, "Forgefile"), ff);
      writeFileSync(join(work, "NOTE.md"), "hook\n");
      const gitEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      };
      execFileSync("git", ["add", "Forgefile", "NOTE.md"], {
        cwd: work,
        env: gitEnv,
      });
      execFileSync("git", ["commit", "-m", "enable auto deploy"], {
        cwd: work,
        env: gitEnv,
      });
      execFileSync("git", ["push", "origin", "HEAD:main"], {
        cwd: work,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });

      const result = await processPostReceiveNotify(
        {
          slug,
          refs: [
            {
              old: "0".repeat(40),
              new: "1".repeat(40),
              ref: "refs/heads/main",
              branch: "main",
            },
          ],
        },
        { enqueueDeploys: false },
      );

      expect(result.projectId).toBe(projectId);
      expect(result.forgefileStatus).toBe("valid");
      expect(result.autoDeployTargets).toContain("web");
      expect(result.commitSha).toBeTruthy();
      expect(existsSync(join(reposRoot, `${slug}-main`, "NOTE.md"))).toBe(true);

      const row = db
        .select()
        .from(projectForgefiles)
        .where(eq(projectForgefiles.projectId, projectId))
        .get();
      expect(row?.status).toBe("valid");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("processPostReceiveNotify unseeded local repo", () => {
  let gitRoot: string;
  let reposRoot: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  let projectId = "";
  let repoId = "";
  let slug = "";
  let barePath = "";

  beforeEach(async () => {
    gitRoot = mkdtempSync(join(tmpdir(), "forge-hook-local-git-"));
    reposRoot = mkdtempSync(join(tmpdir(), "forge-hook-local-repos-"));
    prevGit = process.env.FORGE_GIT_DIR;
    prevRepos = process.env.FORGE_REPOS_DIR;
    process.env.FORGE_GIT_DIR = gitRoot;
    process.env.FORGE_REPOS_DIR = reposRoot;

    slug = `local-hook-${Date.now()}`;
    const created = await createForgeGitRepository({
      name: slug,
      slug,
      seed: false,
    });
    projectId = created.projectId;
    repoId = created.repositoryId;
    barePath = created.barePath;
  });

  afterEach(() => {
    db.delete(projectForgefiles)
      .where(eq(projectForgefiles.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
    else process.env.FORGE_REPOS_DIR = prevRepos;
    rmSync(gitRoot, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  it("clones working tree after the first push", async () => {
    const work = mkdtempSync(join(tmpdir(), "forge-hook-local-push-"));
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    };
    try {
      execFileSync("git", ["init"], { cwd: work, env: gitEnv });
      execFileSync("git", ["checkout", "-B", "main"], { cwd: work, env: gitEnv });
      execFileSync("git", ["remote", "add", "origin", barePath], {
        cwd: work,
        env: gitEnv,
      });
      writeFileSync(join(work, "README.md"), "# local\n");
      writeFileSync(join(work, "Forgefile"), buildSeedForgefile(slug));
      execFileSync("git", ["add", "README.md", "Forgefile"], {
        cwd: work,
        env: gitEnv,
      });
      execFileSync("git", ["commit", "-m", "first"], { cwd: work, env: gitEnv });
      execFileSync("git", ["push", "-u", "origin", "main"], {
        cwd: work,
        env: gitEnv,
      });

      const result = await processPostReceiveNotify(
        {
          slug,
          refs: [
            {
              old: "0".repeat(40),
              new: "1".repeat(40),
              ref: "refs/heads/main",
              branch: "main",
            },
          ],
        },
        { enqueueDeploys: false },
      );

      expect(result.projectId).toBe(projectId);
      expect(result.commitSha).toBeTruthy();
      expect(existsSync(join(reposRoot, `${slug}-main`, "README.md"))).toBe(
        true,
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
