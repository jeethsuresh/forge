import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories, projects, type Project } from "@/lib/db/schema";
import { composeProjectName } from "@/lib/compose-project-name";
import { barePathForSlug, resolveGitBareRoot } from "@/lib/git-paths";
import { installPostReceiveHook } from "@/lib/git-hooks";
import { mintGitCloneToken } from "@/lib/git-clone-token";
import { formatGitError } from "@/lib/git-workspace";
import {
  githubCloneUrl,
  parseGithubRepo,
  prepareGithubGitAuth,
} from "@/lib/github-import";
import { normalizeGitSlug } from "@/lib/git-repo";

const execFileAsync = promisify(execFile);

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

async function execGit(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { ...options, env: gitEnv() });
}

export async function pointWorkingCloneAtForge(
  clonePath: string,
  barePath: string,
): Promise<"origin" | "forge"> {
  if (!existsSync(clonePath)) return "origin";

  let originUrl = "";
  try {
    const { stdout } = await execGit(["remote", "get-url", "origin"], {
      cwd: clonePath,
    });
    originUrl = stdout.trim();
  } catch {
    originUrl = "";
  }

  if (!originUrl) {
    await execGit(["remote", "add", "origin", barePath], { cwd: clonePath });
    return "origin";
  }

  if (originUrl === barePath || originUrl.includes("/api/git/")) {
    return "origin";
  }

  if (originUrl.includes("github.com")) {
    try {
      await execGit(["remote", "get-url", "forge"], { cwd: clonePath });
      await execGit(["remote", "set-url", "forge", barePath], { cwd: clonePath });
    } catch {
      await execGit(["remote", "add", "forge", barePath], { cwd: clonePath });
    }
    await execGit(["config", "remote.pushDefault", "forge"], { cwd: clonePath });
    return "forge";
  }

  await execGit(["remote", "set-url", "origin", barePath], { cwd: clonePath });
  return "origin";
}

export async function attachForgeGitToExistingProject(
  project: Project,
  opts?: { sourceUrl?: string },
): Promise<{ repositoryId: string; slug: string; pushRemote: "origin" | "forge" }> {
  if (project.gitRepositoryId) {
    const existing = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, project.gitRepositoryId))
      .get();
    if (existing) {
      const pushRemote = await pointWorkingCloneAtForge(
        project.clonePath,
        existing.barePath,
      );
      return {
        repositoryId: existing.id,
        slug: existing.slug,
        pushRemote,
      };
    }
  }

  let importedFrom: string | null = null;
  try {
    importedFrom = parseGithubRepo(project.githubRepo);
  } catch {
    importedFrom = project.githubRepo.trim() || null;
  }

  const slugBase =
    importedFrom?.replace("/", "-") ||
    composeProjectName(project.name) ||
    `project-${project.id.slice(0, 8)}`;
  let slug = normalizeGitSlug(slugBase);
  let n = 2;
  while (
    db.select().from(gitRepositories).where(eq(gitRepositories.slug, slug)).get()
  ) {
    slug = normalizeGitSlug(`${slugBase}-${n}`);
    n += 1;
  }

  mkdirSync(resolveGitBareRoot(), { recursive: true });
  const barePath = barePathForSlug(slug);
  if (existsSync(barePath)) {
    throw new Error(`Bare path already exists: ${barePath}`);
  }

  const sourceUrl =
    opts?.sourceUrl?.trim() ||
    (importedFrom ? githubCloneUrl(importedFrom) : "");
  if (!sourceUrl) {
    throw new Error(
      `Project "${project.name}" has no GitHub origin to import into Forge git`,
    );
  }

  if (!opts?.sourceUrl) {
    await prepareGithubGitAuth();
  }

  try {
    await execGit(["clone", "--mirror", sourceUrl, barePath]);
  } catch (err) {
    throw new Error(
      `Failed to migrate ${project.name} into Forge git: ${formatGitError(err)}`,
    );
  }

  await execGit(["config", "http.receivepack", "true"], { cwd: barePath });
  try {
    await execGit(["symbolic-ref", "HEAD", `refs/heads/${project.branch}`], {
      cwd: barePath,
    });
  } catch {
    // keep mirror HEAD
  }
  installPostReceiveHook(barePath, slug);
  try {
    await execGit(["remote", "remove", "origin"], { cwd: barePath });
  } catch {
    // ignore
  }

  const repositoryId = randomUUID();
  const now = new Date();
  db.insert(gitRepositories)
    .values({
      id: repositoryId,
      slug,
      barePath,
      defaultBranch: project.branch,
      importedFrom,
      cloneToken: mintGitCloneToken(repositoryId),
      createdAt: now,
    })
    .run();

  db.update(projects)
    .set({ gitRepositoryId: repositoryId, updatedAt: now })
    .where(eq(projects.id, project.id))
    .run();

  const pushRemote = await pointWorkingCloneAtForge(project.clonePath, barePath);
  return { repositoryId, slug, pushRemote };
}

/** Import leftover GitHub-origin projects into Forge bare repos. */
export async function migrateGithubOriginProjects(): Promise<number> {
  const rows = db
    .select()
    .from(projects)
    .where(isNull(projects.gitRepositoryId))
    .all()
    .filter((project) => Boolean(project.githubRepo?.trim()));

  let migrated = 0;
  for (const project of rows) {
    try {
      await attachForgeGitToExistingProject(project);
      migrated += 1;
      console.log(
        `[forge-git] Migrated ${project.name} (${project.githubRepo}) into Forge git`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[forge-git] Failed to migrate ${project.name}: ${message}`);
    }
  }
  return migrated;
}
