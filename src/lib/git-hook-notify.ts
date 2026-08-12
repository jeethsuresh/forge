import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import { cloneOrPull, getLocalCommitSha } from "@/lib/github";
import { projectForgefile } from "@/lib/forgefile-project";
import { listAutoDeployTargetNames } from "@/lib/forgefile-run";
import { resolveClonePath } from "@/lib/paths";
import { runDeployment } from "@/lib/deployer";
import { resolveGitHookSecret } from "@/lib/git-hooks";

export type PostReceiveRef = {
  old?: string;
  new?: string;
  ref?: string;
  branch?: string;
};

export type PostReceivePayload = {
  slug: string;
  refs?: PostReceiveRef[];
};

export function verifyGitHookSecret(headerValue: string | null): boolean {
  const expected = resolveGitHookSecret();
  const presented = headerValue?.trim() ?? "";
  if (!presented || !expected) return false;
  return presented === expected;
}

function pickBranch(
  projectBranch: string,
  refs: PostReceiveRef[] | undefined,
): string {
  const heads = (refs ?? [])
    .map((r) => {
      if (r.branch && !r.branch.startsWith("refs/")) return r.branch;
      if (r.ref?.startsWith("refs/heads/")) {
        return r.ref.slice("refs/heads/".length);
      }
      return null;
    })
    .filter((b): b is string => Boolean(b));

  if (heads.includes(projectBranch)) return projectBranch;
  if (heads.length > 0) return heads[0]!;
  return projectBranch;
}

/**
 * post-receive notify: refresh working clone, project Forgefile, wake auto_deploy.
 */
export async function processPostReceiveNotify(
  payload: PostReceivePayload,
  options?: { enqueueDeploys?: boolean },
): Promise<{
  projectId: string;
  slug: string;
  branch: string;
  commitSha: string | null;
  forgefileStatus: string;
  autoDeployTargets: string[];
}> {
  const slug = payload.slug?.trim().replace(/\.git$/i, "");
  if (!slug) throw new Error("slug is required");

  const repo = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.slug, slug))
    .get();
  if (!repo) throw new Error(`Unknown git repository slug: ${slug}`);

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.gitRepositoryId, repo.id))
    .get();
  if (!project) throw new Error(`No project linked to git slug: ${slug}`);

  const branch = pickBranch(project.branch, payload.refs);
  const repoPath = resolveClonePath(project.clonePath);
  const commitSha = await cloneOrPull(
    repo.barePath,
    branch,
    repoPath,
    () => {},
  );

  const projection = projectForgefile(project.id, repoPath, commitSha);
  const autoDeployTargets = listAutoDeployTargetNames(project.id);

  const enqueue = options?.enqueueDeploys !== false;
  if (enqueue && autoDeployTargets.length > 0 && project.enabled) {
    for (const deployment of autoDeployTargets) {
      // Fire-and-forget sequential deploys; errors surface in deployment rows.
      void runDeployment(project.id, "auto", {
        branch,
        deployment,
        skipPull: true,
      }).catch((err) => {
        console.error(
          `[git-hook] auto-deploy failed for ${project.name}/${deployment}:`,
          err,
        );
      });
    }
  }

  return {
    projectId: project.id,
    slug,
    branch,
    commitSha: commitSha || (await getLocalCommitSha(repoPath)),
    forgefileStatus: projection.status,
    autoDeployTargets,
  };
}
