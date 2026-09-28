import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { isDeploymentActive } from "@/lib/deployer";
import { archiveAgentSession, listAgentSessions } from "@/lib/agent-runner";
import { destroyBranchWorkspace } from "@/lib/branch-workspace";
import { invalidateProjectBranches } from "@/lib/project-branches-cache";
import {
  deleteLocalBranch,
  getCurrentLocalBranch,
} from "@/lib/project-local-branch-ops";

export interface CleanupSkippedBranch {
  branch: string;
  reason: string;
}

export interface CleanupCompletedAgentsResult {
  archivedSessionIds: string[];
  deletedBranches: string[];
  skipped: CleanupSkippedBranch[];
}

export async function cleanupCompletedAgentSessions(
  projectId: string,
): Promise<CleanupCompletedAgentsResult> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new Error("Project not found");
  if (isDeploymentActive(projectId)) {
    throw new Error("A deployment is in progress. Wait for it to finish.");
  }

  const completed = listAgentSessions(projectId).filter(
    (session) => session.status === "completed" && !session.archivedAt,
  );
  const archivedSessionIds: string[] = [];
  const deletedBranches: string[] = [];
  const skipped: CleanupSkippedBranch[] = [];
  const branchesToDelete = new Set<string>();

  for (const session of completed) {
    await archiveAgentSession(session.id);
    archivedSessionIds.push(session.id);
    branchesToDelete.add(session.branch);
  }

  const currentBranch = await getCurrentLocalBranch(project.clonePath);
  for (const branch of [...branchesToDelete].sort()) {
    if (branch === project.branch) {
      skipped.push({ branch, reason: "watch/deploy branch" });
      continue;
    }
    if (currentBranch && branch === currentBranch) {
      skipped.push({ branch, reason: "currently checked out" });
      continue;
    }
    try {
      await deleteLocalBranch(project.clonePath, branch, {
        watchBranch: project.branch,
        force: true,
      });
      await destroyBranchWorkspace(projectId, branch);
      deletedBranches.push(branch);
    } catch (err) {
      skipped.push({
        branch,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (deletedBranches.length > 0) {
    invalidateProjectBranches(projectId);
  }

  return { archivedSessionIds, deletedBranches, skipped };
}
