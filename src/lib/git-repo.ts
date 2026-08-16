import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import { composeProjectName } from "@/lib/compose-project-name";
import { barePathForSlug, resolveGitBareRoot } from "@/lib/git-paths";
import { installPostReceiveHook } from "@/lib/git-hooks";
import {
  assertSeedForgefileValid,
  buildSeedForgefile,
} from "@/lib/git-seed-forgefile";
import { opsApiBaseUrl } from "@/lib/ops-api-auth";
import { composeNameConflict, validateProjectName } from "@/lib/projects";
import { resolveClonePath } from "@/lib/paths";
import { mintGitCloneToken } from "@/lib/git-clone-token";
import {
  formatGitError,
  githubCloneUrl,
  parseGithubRepo,
  prepareGithubGitAuth,
} from "@/lib/github";

const execFileAsync = promisify(execFile);

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: process.env.FORGE_GIT_USER_NAME?.trim() || "Forge",
    GIT_AUTHOR_EMAIL:
      process.env.FORGE_GIT_USER_EMAIL?.trim() || "forge@localhost",
    GIT_COMMITTER_NAME: process.env.FORGE_GIT_USER_NAME?.trim() || "Forge",
    GIT_COMMITTER_EMAIL:
      process.env.FORGE_GIT_USER_EMAIL?.trim() || "forge@localhost",
  };
}

async function execGit(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { ...options, env: gitEnv() });
}

export function normalizeGitSlug(input: string): string {
  const slug = composeProjectName(input.replace(/\.git$/i, ""));
  if (!slug || slug === "forge-project") {
    const fallback = composeProjectName(input.trim() || "project");
    return fallback === "forge-project"
      ? `project-${randomUUID().slice(0, 8)}`
      : fallback;
  }
  return slug;
}

export function forgeGitHttpsUrl(slug: string): string {
  const clean = slug.trim().replace(/\.git$/i, "");
  return `${opsApiBaseUrl()}/api/git/${clean}.git`;
}

export function forgeGitSshUrl(slug: string): string {
  const clean = slug.trim().replace(/\.git$/i, "");
  const host =
    process.env.FORGE_GIT_SSH_HOST?.trim() ||
    process.env.FORGE_PUBLIC_HOST?.trim() ||
    "localhost";
  return `git@${host}:${clean}.git`;
}

export function workingClonePathForSlug(slug: string, branch: string): string {
  const reposDir = resolveClonePath(
    process.env.FORGE_REPOS_DIR ?? "./data/repos",
  );
  return join(reposDir, `${slug}-${branch}`);
}

export function bareRepoHasCommits(barePath: string): boolean {
  if (!existsSync(barePath)) return false;
  try {
    const stdout = execFileSync("git", ["rev-list", "-n", "1", "--all"], {
      cwd: barePath,
      encoding: "utf8",
      env: gitEnv(),
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function gitRepositoryIsEmpty(
  repo: { barePath: string } | null | undefined,
): boolean {
  if (!repo) return false;
  return !bareRepoHasCommits(repo.barePath);
}

export type CreateForgeGitRepositoryOpts = {
  name: string;
  slug?: string;
  defaultBranch?: string;
  /** When false, empty bare repo for Add local (no seed commit, no working clone). */
  seed?: boolean;
};

export type CreateForgeGitRepositoryResult = {
  repositoryId: string;
  projectId: string;
  slug: string;
  barePath: string;
  httpsUrl: string;
  sshUrl: string;
};

export async function createForgeGitRepository(
  opts: CreateForgeGitRepositoryOpts,
): Promise<CreateForgeGitRepositoryResult> {
  const trimmedName = opts.name.trim();
  const nameError = validateProjectName(trimmedName);
  if (nameError) throw new Error(nameError);

  const conflict = composeNameConflict(trimmedName);
  if (conflict) throw new Error(conflict);

  const slug = normalizeGitSlug(opts.slug?.trim() || trimmedName);
  const defaultBranch = (opts.defaultBranch?.trim() || "main").replace(
    /^refs\/heads\//,
    "",
  );

  const existing = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.slug, slug))
    .get();
  if (existing) {
    throw new Error(`Git repository slug "${slug}" already exists`);
  }

  mkdirSync(resolveGitBareRoot(), { recursive: true });
  const barePath = barePathForSlug(slug);
  if (existsSync(barePath)) {
    throw new Error(`Bare path already exists: ${barePath}`);
  }

  await execGit(["init", "--bare", barePath]);
  await execGit(["config", "http.receivepack", "true"], { cwd: barePath });
  await execGit(["symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`], {
    cwd: barePath,
  });
  installPostReceiveHook(barePath, slug);

  const shouldSeed = opts.seed !== false;
  if (shouldSeed) {
    const seedDir = mkdtempSync(join(tmpdir(), "forge-git-seed-"));
    try {
      await execGit(["clone", barePath, seedDir]);
      await execGit(["checkout", "-B", defaultBranch], { cwd: seedDir });

      writeFileSync(
        join(seedDir, "README.md"),
        `# ${trimmedName}\n\nHosted by Forge. Clone via HTTPS or SSH from the project Settings page.\n`,
      );
      const forgefile = buildSeedForgefile(trimmedName);
      assertSeedForgefileValid(forgefile);
      writeFileSync(join(seedDir, "Forgefile"), forgefile);

      await execGit(["add", "README.md", "Forgefile"], { cwd: seedDir });
      await execGit(["commit", "-m", "Initial commit (Forge seed)"], {
        cwd: seedDir,
      });
      await execGit(["push", "-u", "origin", defaultBranch], { cwd: seedDir });
    } finally {
      rmSync(seedDir, { recursive: true, force: true });
    }
  }

  const repositoryId = randomUUID();
  const projectId = randomUUID();
  const now = new Date();
  const clonePath = workingClonePathForSlug(slug, defaultBranch);
  if (existsSync(clonePath)) {
    rmSync(clonePath, { recursive: true, force: true });
  }
  if (shouldSeed) {
    await execGit(["clone", "--branch", defaultBranch, barePath, clonePath]);
  }

  db.insert(gitRepositories)
    .values({
      id: repositoryId,
      slug,
      barePath,
      defaultBranch,
      importedFrom: null,
      cloneToken: mintGitCloneToken(repositoryId),
      createdAt: now,
    })
    .run();

  db.insert(projects)
    .values({
      id: projectId,
      name: trimmedName,
      githubRepo: "",
      branch: defaultBranch,
      clonePath,
      enabled: true,
      gitRepositoryId: repositoryId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    repositoryId,
    projectId,
    slug,
    barePath,
    httpsUrl: forgeGitHttpsUrl(slug),
    sshUrl: forgeGitSshUrl(slug),
  };
}

export type ImportGithubToForgeOpts = {
  githubRepo: string;
  name?: string;
  slug?: string;
  branch?: string;
  /** Override clone source (local bare stand-in for tests). */
  sourceUrl?: string;
};

export type ImportGithubToForgeResult = CreateForgeGitRepositoryResult & {
  importedFrom: string;
};

export async function importGithubToForge(
  opts: ImportGithubToForgeOpts,
): Promise<ImportGithubToForgeResult> {
  const githubRepo = parseGithubRepo(opts.githubRepo);
  const trimmedName = (
    opts.name?.trim() ||
    githubRepo.split("/")[1] ||
    githubRepo
  ).trim();
  const nameError = validateProjectName(trimmedName);
  if (nameError) throw new Error(nameError);

  const conflict = composeNameConflict(trimmedName);
  if (conflict) throw new Error(conflict);

  const slug = normalizeGitSlug(
    opts.slug?.trim() || githubRepo.replace("/", "-") || trimmedName,
  );
  const defaultBranch = (opts.branch?.trim() || "main").replace(
    /^refs\/heads\//,
    "",
  );

  const existing = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.slug, slug))
    .get();
  if (existing) {
    throw new Error(`Git repository slug "${slug}" already exists`);
  }

  mkdirSync(resolveGitBareRoot(), { recursive: true });
  const barePath = barePathForSlug(slug);
  if (existsSync(barePath)) {
    throw new Error(`Bare path already exists: ${barePath}`);
  }

  const sourceUrl = opts.sourceUrl?.trim() || githubCloneUrl(githubRepo);
  if (!opts.sourceUrl) {
    await prepareGithubGitAuth();
  }

  try {
    await execGit(["clone", "--mirror", sourceUrl, barePath]);
  } catch (err) {
    throw new Error(`Failed to import ${githubRepo}: ${formatGitError(err)}`);
  }

  await execGit(["config", "http.receivepack", "true"], { cwd: barePath });
  try {
    await execGit(["symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`], {
      cwd: barePath,
    });
  } catch {
    // Keep whatever HEAD the mirror had if the requested branch is missing.
  }
  installPostReceiveHook(barePath, slug);

  try {
    await execGit(["remote", "remove", "origin"], { cwd: barePath });
  } catch {
    // mirrors may not expose origin the same way; ignore
  }

  const repositoryId = randomUUID();
  const projectId = randomUUID();
  const now = new Date();
  const clonePath = workingClonePathForSlug(slug, defaultBranch);
  if (existsSync(clonePath)) {
    rmSync(clonePath, { recursive: true, force: true });
  }
  mkdirSync(dirname(clonePath), { recursive: true });

  try {
    await execGit(["clone", "--branch", defaultBranch, barePath, clonePath]);
  } catch {
    await execGit(["clone", barePath, clonePath]);
    try {
      await execGit(["checkout", "-B", defaultBranch], { cwd: clonePath });
    } catch {
      // leave default checkout
    }
  }

  db.insert(gitRepositories)
    .values({
      id: repositoryId,
      slug,
      barePath,
      defaultBranch,
      importedFrom: githubRepo,
      cloneToken: mintGitCloneToken(repositoryId),
      createdAt: now,
    })
    .run();

  db.insert(projects)
    .values({
      id: projectId,
      name: trimmedName,
      githubRepo,
      branch: defaultBranch,
      clonePath,
      enabled: true,
      gitRepositoryId: repositoryId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    repositoryId,
    projectId,
    slug,
    barePath,
    httpsUrl: forgeGitHttpsUrl(slug),
    sshUrl: forgeGitSshUrl(slug),
    importedFrom: githubRepo,
  };
}
