import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, type Project } from "@/lib/db/schema";
import { getRemoteCommitSha } from "@/lib/github";
import type { ProjectReleaseState } from "@/lib/deploy-rollback";
import {
  computeForgeUpdateAvailability,
  resolveForgeBranchDeployAllowed,
  type ForgeUpdateAvailabilityResult,
} from "@/lib/self-update-helpers";

export interface DeployUpdateView {
  branch: string;
  deployedCommitSha: string | null;
  remoteCommitSha: string | null;
  updateAvailable: boolean;
  deployAllowed: boolean;
  remoteCommitLookupFailed: boolean;
  reason: ForgeUpdateAvailabilityResult["reason"];
}

export function getSuccessfulDeployCommitForBranch(
  projectId: string,
  branch: string,
): string | null {
  const row = db
    .select({ commitSha: deployments.commitSha })
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, projectId),
        eq(deployments.branch, branch),
        eq(deployments.status, "success"),
        isNotNull(deployments.commitSha),
      ),
    )
    .orderBy(desc(deployments.completedAt))
    .limit(1)
    .get();
  return row?.commitSha ?? null;
}

export function deployedCommitShaForProjectBranch(
  project: Project,
  branch: string,
  isForge: boolean,
  releaseState: ProjectReleaseState | null,
): string | null {
  if (isForge) {
    return releaseState?.stableCommitSha ?? null;
  }
  return getSuccessfulDeployCommitForBranch(project.id, branch);
}

export function computeProjectDeployUpdate(input: {
  branch: string;
  watchBranch: string;
  isForge: boolean;
  deployedCommitSha: string | null;
  remoteCommitSha: string | null;
  remoteCommitLookupFailed: boolean;
}): DeployUpdateView {
  const availability = input.isForge
    ? resolveForgeBranchDeployAllowed(input.branch, input.watchBranch, {
        runningCommitSha: input.deployedCommitSha,
        remoteCommitSha: input.remoteCommitSha,
        remoteCommitLookupFailed: input.remoteCommitLookupFailed,
      })
    : computeForgeUpdateAvailability({
        runningCommitSha: input.deployedCommitSha,
        remoteCommitSha: input.remoteCommitSha,
        remoteCommitLookupFailed: input.remoteCommitLookupFailed,
      });

  return {
    branch: input.branch,
    deployedCommitSha: input.deployedCommitSha,
    remoteCommitSha: input.remoteCommitSha,
    updateAvailable: availability.updateAvailable,
    deployAllowed: availability.deployAllowed,
    remoteCommitLookupFailed: availability.remoteCommitLookupFailed,
    reason: availability.reason,
  };
}

export async function resolveProjectDeployUpdate(
  project: Project,
  branch: string,
  options: {
    isForge: boolean;
    releaseState: ProjectReleaseState | null;
  },
): Promise<DeployUpdateView> {
  const deployedCommitSha = deployedCommitShaForProjectBranch(
    project,
    branch,
    options.isForge,
    options.releaseState,
  );

  let remoteCommitSha: string | null = null;
  let remoteCommitLookupFailed = false;
  try {
    remoteCommitSha = await getRemoteCommitSha(project.githubRepo, branch);
  } catch {
    remoteCommitSha = null;
    remoteCommitLookupFailed = true;
  }

  return computeProjectDeployUpdate({
    branch,
    watchBranch: project.branch,
    isForge: options.isForge,
    deployedCommitSha,
    remoteCommitSha,
    remoteCommitLookupFailed,
  });
}
