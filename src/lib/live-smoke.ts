/**
 * Enablement for Layer C live Forge smoke / cutover tests.
 * See docs/superpowers/specs/2026-07-20-deploy-agent-resilience-tests-design.md
 */

export function isAgentOpsContext(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const token = env.FORGE_OPS_API_TOKEN?.trim() ?? "";
  const base = env.FORGE_OPS_API_BASE?.trim() ?? "";
  return token.startsWith("fos.") && base.length > 0;
}

/** True when running inside the self-updater’s staging ./test.sh — never nest cutover. */
export function isSelfUpdateTestStage(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.FORGE_UPDATE_ID?.trim()) return true;
  if (env.FORGE_UPDATER === "1") return true;
  const project = env.COMPOSE_PROJECT_NAME?.trim() ?? "";
  if (/staging/i.test(project)) return true;
  return false;
}

export function shouldRunLiveSmoke(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.FORGE_LIVE_SMOKE === "0") return false;
  if (isSelfUpdateTestStage(env)) return false;
  if (env.FORGE_LIVE_SMOKE === "1") return true;
  return isAgentOpsContext(env);
}

/** Patterns that must not appear as the effective failure in live cutover logs. */
export const LIVE_SMOKE_FORBIDDEN_LOG_PATTERNS: readonly RegExp[] = [
  /Install the buildx component to build images with BuildKit/i,
  /cannot open ['"]?\.git\/FETCH_HEAD['"]?/i,
  /Permission denied on FETCH_HEAD/i,
  /Permission denied.*FETCH_HEAD/i,
];

export function liveSmokeLogsContainForbiddenFailure(logs: string): string | null {
  for (const pattern of LIVE_SMOKE_FORBIDDEN_LOG_PATTERNS) {
    if (pattern.test(logs)) {
      return pattern.source;
    }
  }
  // Buildx deprecation alone is OK if a clearer daemon error is also present;
  // fail only when buildx is present without an actionable runtime connect error.
  if (
    /legacy builder is deprecated/i.test(logs) &&
    /buildx/i.test(logs) &&
    !/Cannot connect to (the Docker daemon|container runtime)/i.test(logs)
  ) {
    return "buildx-masked failure without container runtime error";
  }
  return null;
}
