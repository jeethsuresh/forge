import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments } from "@/lib/db/schema";
import { deploymentRowForClient } from "@/lib/project-poll";
import {
  resolveAgentSessionDeployLogView,
  type ActiveDeployLogView,
  type DeploymentLogSource,
} from "@/lib/active-deploy-logs";

export function getAgentSessionDeployment(
  deploymentId: string | null | undefined,
): DeploymentLogSource | null {
  if (!deploymentId) return null;

  const row = db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get();
  if (!row) return null;

  return deploymentRowForClient(row, { includeLogs: true });
}

export function resolveAgentSessionDeployLogs(input: {
  sessionStatus: string;
  deploymentId: string | null | undefined;
}): ActiveDeployLogView | null {
  const deployment = getAgentSessionDeployment(input.deploymentId);
  return resolveAgentSessionDeployLogView({
    sessionStatus: input.sessionStatus,
    deployment,
  });
}
