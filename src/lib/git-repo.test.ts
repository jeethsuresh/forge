import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { execFileSync } from "child_process";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import {
  bareRepoHasCommits,
  createForgeGitRepository,
  importGithubToForge,
} from "@/lib/git-repo";
import { buildSeedForgefile, assertSeedForgefileValid } from "@/lib/git-seed-forgefile";
import { parseForgefileYaml } from "@/lib/forgefile-parse";

describe("buildSeedForgefile", () => {
  it("produces a valid minimal Forgefile", () => {
    const content = buildSeedForgefile("Demo App");
    assertSeedForgefileValid(content);
    const parsed = parseForgefileYaml(content);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.project.name).toBe("Demo App");
      expect(Object.keys(parsed.value.deployments).length).toBeGreaterThan(0);
    }
  });
});

describe("createForgeGitRepository", () => {
  let gitRoot: string;
  let reposRoot: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  let createdProjectId: string | null = null;
  let createdRepoId: string | null = null;

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), "forge-bare-"));
    reposRoot = mkdtempSync(join(tmpdir(), "forge-repos-"));
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

  it("creates a bare repo seeded with README + Forgefile and links a project", async () => {
    const unique = `seed-${Date.now()}`;
    const result = await createForgeGitRepository({
      name: unique,
      slug: unique,
      defaultBranch: "main",
    });
    createdProjectId = result.projectId;
    createdRepoId = result.repositoryId;

    expect(existsSync(result.barePath)).toBe(true);
    expect(existsSync(join(result.barePath, "hooks", "post-receive"))).toBe(
      true,
    );
    expect(result.httpsUrl).toContain(`/api/git/${unique}.git`);
    expect(result.sshUrl).toContain(`${unique}.git`);

    const repo = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, result.repositoryId))
      .get();
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, result.projectId))
      .get();

    expect(repo?.slug).toBe(unique);
    expect(repo?.importedFrom).toBeNull();
    expect(repo?.cloneToken?.startsWith("fgc.")).toBe(true);
    expect(project?.gitRepositoryId).toBe(result.repositoryId);
    expect(project?.githubRepo).toBe("");

    const work = mkdtempSync(join(tmpdir(), "forge-clone-check-"));
    try {
      execFileSync("git", ["clone", result.barePath, work], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      expect(readFileSync(join(work, "README.md"), "utf8")).toContain(unique);
      const forgefile = readFileSync(join(work, "Forgefile"), "utf8");
      assertSeedForgefileValid(forgefile);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("creates an unseeded bare repo for local add without a working clone", async () => {
    const unique = `local-${Date.now()}`;
    const result = await createForgeGitRepository({
      name: unique,
      slug: unique,
      defaultBranch: "main",
      seed: false,
    });
    createdProjectId = result.projectId;
    createdRepoId = result.repositoryId;

    expect(existsSync(result.barePath)).toBe(true);
    expect(existsSync(join(result.barePath, "hooks", "post-receive"))).toBe(
      true,
    );
    expect(bareRepoHasCommits(result.barePath)).toBe(false);
    expect(existsSync(join(reposRoot, `${unique}-main`))).toBe(false);

    const count = execFileSync("git", ["rev-list", "--all", "--count"], {
      cwd: result.barePath,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
    expect(count).toBe("0");

    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, result.projectId))
      .get();
    expect(project?.gitRepositoryId).toBe(result.repositoryId);
    expect(project?.githubRepo).toBe("");
  });

  it("imports from a local bare GitHub stand-in", async () => {
    const standIn = mkdtempSync(join(tmpdir(), "gh-standin-"));
    const seed = mkdtempSync(join(tmpdir(), "gh-seed-"));
    try {
      execFileSync("git", ["init", "--bare", standIn], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      execFileSync("git", ["clone", standIn, seed], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      writeFileSync(join(seed, "README.md"), "# imported\n");
      execFileSync("git", ["add", "README.md"], {
        cwd: seed,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: seed,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      });
      execFileSync("git", ["push", "origin", "HEAD:main"], {
        cwd: seed,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });

      const unique = `import-${Date.now()}`;
      const result = await importGithubToForge({
        githubRepo: `acme/${unique}`,
        name: unique,
        slug: unique,
        branch: "main",
        sourceUrl: standIn,
      });
      createdProjectId = result.projectId;
      createdRepoId = result.repositoryId;

      expect(result.importedFrom).toBe(`acme/${unique}`);
      const repo = db
        .select()
        .from(gitRepositories)
        .where(eq(gitRepositories.id, result.repositoryId))
        .get();
      expect(repo?.importedFrom).toBe(`acme/${unique}`);
      expect(existsSync(join(result.barePath, "hooks", "post-receive"))).toBe(
        true,
      );
      expect(existsSync(join(reposRoot, `${unique}-main`, "README.md"))).toBe(
        true,
      );
    } finally {
      rmSync(standIn, { recursive: true, force: true });
      rmSync(seed, { recursive: true, force: true });
    }
  });
});
