import { authenticateOpsRequest, presentedOpsToken } from "@/lib/ops-api-auth";
import { secretsEqual } from "@/lib/secrets-equal";

export function authorizeForgeRecoverRequest(request: Request): boolean {
  const presented = presentedOpsToken(request);
  if (!presented) return false;

  const recover = process.env.FORGE_RECOVER_SECRET?.trim();
  if (recover && secretsEqual(presented, recover)) return true;

  return authenticateOpsRequest(request) !== null;
}
