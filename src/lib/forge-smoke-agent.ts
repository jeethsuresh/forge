/**
 * Helpers for the Forge agent → marker → redeploy live smoke path.
 * Kept pure so offline unit tests can lock the contract without hitting Ops.
 */

export const FORGE_SMOKE_MARKER_RELATIVE_PATH = "public/forge-smoke-marker.txt";

/** In-container path after the runner image copies public/ → /app/public. */
export const FORGE_SMOKE_MARKER_CONTAINER_PATH = "/app/public/forge-smoke-marker.txt";

export function buildForgeSmokeBranchName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `forge-smoke/${stamp}`;
}

export function buildForgeSmokeMarkerToken(uniqueId: string): string {
  return `SMOKE_MARKER_${uniqueId}`;
}

export function buildForgeSmokeAgentPrompt(markerToken: string): string {
  return [
    `Create the file ${FORGE_SMOKE_MARKER_RELATIVE_PATH} containing exactly this single line and nothing else:`,
    markerToken,
    "",
    "Do not modify any other files.",
    "Do not run ./deploy.sh or any deploy scripts.",
    "When the file is written, stop — Forge will commit/push and redeploy separately.",
  ].join("\n");
}

export function forgeSmokeMarkerMatches(
  fileContents: string,
  markerToken: string,
): boolean {
  return fileContents.trim() === markerToken.trim();
}
