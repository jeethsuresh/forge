import type { ContainerInfo } from "@/lib/docker";
import { isContainerRunningState } from "@/lib/container-runtime";

export type RuntimeStatus =
  | "deploying"
  | "running"
  | "stopped"
  | "partial"
  | "not_deployed"
  | "unknown";

export function deriveRuntimeStatus(
  containers: ContainerInfo[],
  options: {
    isDeploying: boolean;
    hasSuccessfulDeploy: boolean;
    hasComposeFile: boolean;
  },
): RuntimeStatus {
  if (options.isDeploying) return "deploying";
  if (!options.hasSuccessfulDeploy) return "not_deployed";
  if (!options.hasComposeFile) return "unknown";

  const runningCount = containers.filter((c) =>
    isContainerRunningState(c.state, c.status),
  ).length;
  if (runningCount === 0) return "stopped";
  if (runningCount === containers.length) return "running";
  return "partial";
}
