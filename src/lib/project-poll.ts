import type { deployments } from "@/lib/db/schema";

const ACTIVE_DEPLOY_STATUSES = new Set([
  "pending",
  "pulling",
  "building",
  "testing",
  "staging",
  "deploying",
  "health_check",
]);

export function isActiveDeploymentStatus(status: string): boolean {
  return ACTIVE_DEPLOY_STATUSES.has(status);
}

export function deploymentRowForClient(
  row: typeof deployments.$inferSelect,
  options: { includeLogs: boolean },
): typeof deployments.$inferSelect {
  if (options.includeLogs || isActiveDeploymentStatus(row.status)) {
    return row;
  }
  return { ...row, logs: "" };
}
