import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import { getComposeContainerStatus, projectHasComposeFile } from "@/lib/docker";
import { isDeploymentActive } from "@/lib/deployer";
import { deriveRuntimeStatus } from "@/lib/project-status";
import { composeProjectName } from "@/lib/compose-project-name";
import { getBlockingAgentSession, isAgentSessionActive } from "@/lib/agent-state";
import {
  hasRollbackImage,
  projectSupportsRollback,
  readProjectReleaseState,
} from "@/lib/deploy-rollback";
import { isForgeProject } from "@/lib/forge-project";
import { getForgeStatus } from "@/lib/self-update";
import { getRemoteCommitSha, listAvailableBranches } from "@/lib/github";
import { deploymentRowForClient } from "@/lib/project-poll";
import { projectComposeSlug } from "@/lib/projects";
import {
  computeProjectDeployUpdate,
  deployedCommitShaForProjectBranch,
} from "@/lib/project-deploy-update";
import {
  getBranchAgentOverview,
  listAgentSessionsForClient,
} from "@/lib/agent-runner";
import { projectRoutingView } from "@/lib/project-routing";

export async function buildOpsProjectSummary(project: typeof projects.$inferSelect) {
  const forge = isForgeProject(project);
  const composeSlug = projectComposeSlug(project);
  const containers = await getComposeContainerStatus(project.clonePath, composeSlug);

  const latest = db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, project.id))
    .orderBy(desc(deployments.startedAt))
    .limit(1)
    .get();

  const latestSuccess = db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, project.id))
    .orderBy(desc(deployments.completedAt))
    .all()
    .find((d) => d.status === "success");

  const forgeStatus = forge ? await getForgeStatus() : null;
  const isDeploying =
    isDeploymentActive(project.id) || (forge && Boolean(forgeStatus?.activeUpdate));

  return {
    id: project.id,
    name: project.name,
    composeProjectName: composeProjectName(project.name),
    githubRepo: project.githubRepo,
    branch: project.branch,
    enabled: project.enabled,
    isForge: forge,
    runtimeStatus: deriveRuntimeStatus(containers, {
      isDeploying,
      hasSuccessfulDeploy:
        latestSuccess !== undefined ||
        Boolean(readProjectReleaseState(project.id, project)?.stableCommitSha),
      hasComposeFile: projectHasComposeFile(project.clonePath),
    }),
    isDeploying,
    latestDeployment: latest ? deploymentRowForClient(latest, { includeLogs: false }) : null,
    containerCount: containers.length,
  };
}

export async function buildOpsProjectDetail(project: typeof projects.$inferSelect) {
  const forge = isForgeProject(project);
  const composeSlug = projectComposeSlug(project);
  const releaseState = readProjectReleaseState(project.id, project);
  const routing = projectRoutingView(project);
  const supportsRollback = projectSupportsRollback(project);

  const [containers, branches, forgeStatus, rollbackAvailable] = await Promise.all([
    getComposeContainerStatus(project.clonePath, composeSlug),
    listAvailableBranches(project.branch, project.clonePath, { fetchRemote: false }),
    forge ? getForgeStatus() : Promise.resolve(null),
    supportsRollback ? hasRollbackImage(project) : Promise.resolve(false),
  ]);

  const history = db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, project.id))
    .orderBy(desc(deployments.startedAt))
    .limit(20)
    .all();

  const clientDeployments = history.map((row) =>
    deploymentRowForClient(row, { includeLogs: true }),
  );

  const currentDeployment =
    clientDeployments.find((d) => d.status === "success") ??
    clientDeployments[0] ??
    null;

  const isDeploying =
    isDeploymentActive(project.id) || (forge && Boolean(forgeStatus?.activeUpdate));

  let deployUpdate = null;
  try {
    const remoteSha = await getRemoteCommitSha(project.githubRepo, project.branch);
    deployUpdate = computeProjectDeployUpdate({
      branch: project.branch,
      watchBranch: project.branch,
      isForge: forge,
      deployedCommitSha: deployedCommitShaForProjectBranch(
        project,
        project.branch,
        forge,
        releaseState,
      ),
      remoteCommitSha: remoteSha,
      remoteCommitLookupFailed: false,
    });
  } catch {
    deployUpdate = computeProjectDeployUpdate({
      branch: project.branch,
      watchBranch: project.branch,
      isForge: forge,
      deployedCommitSha: deployedCommitShaForProjectBranch(
        project,
        project.branch,
        forge,
        releaseState,
      ),
      remoteCommitSha: null,
      remoteCommitLookupFailed: true,
    });
  }

  const sessions = listAgentSessionsForClient(project.id);
  const branchOverview = await getBranchAgentOverview(project.id);

  return {
    project: {
      id: project.id,
      name: project.name,
      githubRepo: project.githubRepo,
      branch: project.branch,
      enabled: project.enabled,
      isForge: forge,
      composeProjectName: composeProjectName(project.name),
      hostPort: routing.hostPort,
      resolvedHostPort: routing.resolvedHostPort,
    },
    runtimeStatus: deriveRuntimeStatus(containers, {
      isDeploying,
      hasSuccessfulDeploy:
        clientDeployments.some((d) => d.status === "success") ||
        Boolean(releaseState?.stableCommitSha),
      hasComposeFile: projectHasComposeFile(project.clonePath),
    }),
    isDeploying,
    containers,
    branches,
    currentDeployment,
    recentDeployments: clientDeployments,
    deployUpdate,
    releaseState,
    forgeStatus: forgeStatus
      ? {
          updateAvailable: forgeStatus.updateAvailable,
          deployAllowed: forgeStatus.deployAllowed,
          activeUpdate: forgeStatus.activeUpdate,
          runningCommitSha: forgeStatus.runningCommitSha,
          remoteCommitSha: forgeStatus.remoteCommitSha,
        }
      : null,
    supportsRollback,
    hasRollbackImage: rollbackAvailable,
    blockingAgentSession: getBlockingAgentSession(project.id),
    hasActiveAgentSession: isAgentSessionActive(project.id),
    agentSessions: sessions,
    agentBranches: branchOverview,
  };
}

export function getOpsDeployment(projectId: string, deploymentId: string) {
  const row = db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get();
  if (!row || row.projectId !== projectId) return null;
  return deploymentRowForClient(row, { includeLogs: true });
}

export function listOpsDeployments(projectId: string, limit = 20) {
  return db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, projectId))
    .orderBy(desc(deployments.startedAt))
    .limit(limit)
    .all()
    .map((row) => deploymentRowForClient(row, { includeLogs: false }));
}
