import { isActiveDeploymentStatus } from "@/lib/project-poll";
import { statusLabel as forgeUpdateStatusLabel } from "@/lib/self-update-helpers";

export interface ActiveDeployLogView {
  title: string;
  status: string;
  statusLabel: string;
  branch: string | null;
  commitSha: string | null;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
}

interface DeploymentLike {
  id: string;
  status: string;
  branch: string;
  commitSha: string | null;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
}

interface ForgeUpdateLike {
  id: string;
  status: string;
  targetCommitSha: string | null;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
}

export function deployStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "pulling":
      return "Pulling source";
    case "building":
      return "Building";
    case "testing":
      return "Testing";
    case "staging":
      return "Staging";
    case "deploying":
      return "Deploying";
    case "health_check":
      return "Health check";
    case "cutover":
      return "Cutover";
    case "success":
      return "Success";
    case "failed":
      return "Failed";
    case "rolled_back":
      return "Rolled back";
    default:
      return forgeUpdateStatusLabel(status);
  }
}

export function resolveActiveDeployLogView(input: {
  isForge: boolean;
  forgeTitle: string;
  deployments: DeploymentLike[];
  activeForgeUpdate: ForgeUpdateLike | null | undefined;
}): ActiveDeployLogView | null {
  if (input.isForge && input.activeForgeUpdate) {
    const update = input.activeForgeUpdate;
    return {
      title: input.forgeTitle,
      status: update.status,
      statusLabel: deployStatusLabel(update.status),
      branch: null,
      commitSha: update.targetCommitSha,
      logs: update.logs,
      errorMessage: update.errorMessage,
      startedAt: update.startedAt,
    };
  }

  const activeDeployment = input.deployments.find((deployment) =>
    isActiveDeploymentStatus(deployment.status),
  );
  if (!activeDeployment) return null;

  return {
    title: "Deployment in progress",
    status: activeDeployment.status,
    statusLabel: deployStatusLabel(activeDeployment.status),
    branch: activeDeployment.branch,
    commitSha: activeDeployment.commitSha,
    logs: activeDeployment.logs,
    errorMessage: activeDeployment.errorMessage,
    startedAt: activeDeployment.startedAt,
  };
}
