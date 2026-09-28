import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import {
  createForgeGitRepository,
  gitRepositoryIsEmpty,
  importGithubToForge,
} from "@/lib/git-repo";

export type OpsProjectCreateMode = "create" | "import";

export type OpsProjectCreateInput = {
  mode?: string;
  name?: string;
  slug?: string;
  branch?: string;
  githubRepo?: string;
  /** Test-only GitHub stand-in. Never accepted from the HTTP body. */
  sourceUrl?: string;
};

export type OpsProjectCreateResult = {
  projectId: string;
  repositoryId: string;
  name: string;
  gitSlug: string;
  branch: string;
  httpsCloneUrl: string;
  sshCloneUrl: string;
  gitEmpty: boolean;
  importedFrom: string | null;
  mode: OpsProjectCreateMode;
};

export function resolveOpsProjectCreateMode(input: {
  mode?: string;
  name?: string;
  githubRepo?: string;
}): OpsProjectCreateMode {
  const mode = input.mode?.trim();
  if (mode === "image") {
    throw new Error(
      "mode=image is dashboard-only; create image projects from the UI",
    );
  }
  if (mode === "import") return "import";
  if (mode === "create" || mode === "local") return "create";
  if (input.githubRepo?.trim()) return "import";
  if (input.name?.trim()) return "create";
  throw new Error("Provide mode=create, mode=import, or mode=local");
}

export function opsProjectCreateHttpStatus(message: string): number {
  return /already exists|conflict|Another project/i.test(message) ? 409 : 400;
}

export async function createProjectViaOps(
  input: OpsProjectCreateInput,
): Promise<OpsProjectCreateResult> {
  const mode = resolveOpsProjectCreateMode(input);

  if (mode === "import") {
    if (!input.githubRepo?.trim()) {
      throw new Error("GitHub repository is required to import");
    }
    const imported = await importGithubToForge({
      githubRepo: input.githubRepo,
      name: input.name,
      slug: input.slug,
      branch: input.branch,
      sourceUrl: input.sourceUrl,
    });
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, imported.projectId))
      .get();
    const repo = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, imported.repositoryId))
      .get();
    return {
      projectId: imported.projectId,
      repositoryId: imported.repositoryId,
      name: project?.name ?? input.name?.trim() ?? imported.slug,
      gitSlug: imported.slug,
      branch: project?.branch ?? (input.branch?.trim() || "main"),
      httpsCloneUrl: imported.httpsUrl,
      sshCloneUrl: imported.sshUrl,
      gitEmpty: gitRepositoryIsEmpty(repo),
      importedFrom: imported.importedFrom,
      mode,
    };
  }

  if (!input.name?.trim()) {
    throw new Error("Name is required to create a project");
  }
  const created = await createForgeGitRepository({
    name: input.name,
    slug: input.slug,
    defaultBranch: input.branch,
    seed: true,
  });
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, created.projectId))
    .get();
  const repo = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.id, created.repositoryId))
    .get();
  return {
    projectId: created.projectId,
    repositoryId: created.repositoryId,
    name: project?.name ?? input.name.trim(),
    gitSlug: created.slug,
    branch: project?.branch ?? (input.branch?.trim() || "main"),
    httpsCloneUrl: created.httpsUrl,
    sshCloneUrl: created.sshUrl,
    gitEmpty: gitRepositoryIsEmpty(repo),
    importedFrom: null,
    mode: "create",
  };
}
