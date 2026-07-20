import type { OpsAuth } from "@/lib/ops-api-auth";
import type { ForgeUpdateStatus } from "@/lib/db/schema";

/**
 * Session tokens may self-authorize a Forge cutover while mid-turn so agents
 * can run live smoke / finish deploys without a 409 from their own session.
 */
export function shouldAuthorizeActiveSessionDeploy(options: {
  auth: OpsAuth;
  authorizeActiveSessionDeploy: boolean;
  blockingSessionId: string | null | undefined;
}): boolean {
  if (!options.authorizeActiveSessionDeploy) return false;
  if (options.auth.kind !== "session") return false;
  if (!options.blockingSessionId) return false;
  return options.blockingSessionId === options.auth.sessionId;
}

export function isForgeUpdateTerminalStatus(
  status: ForgeUpdateStatus,
): status is "success" | "failed" | "rolled_back" {
  return (
    status === "success" || status === "failed" || status === "rolled_back"
  );
}

export function isForgeUpdateSuccessful(status: ForgeUpdateStatus): boolean {
  return status === "success";
}
