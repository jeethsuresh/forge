import type { ForgeUpdateStatus } from "@/lib/db/schema";

export const FORGE_IN_PROGRESS_STATUSES: ForgeUpdateStatus[] = [
  "pending",
  "pulling",
  "building",
  "testing",
  "staging",
  "cutover",
  "health_check",
];

export const FORGE_TERMINAL_STATUSES: ForgeUpdateStatus[] = [
  "success",
  "failed",
  "rolled_back",
];

export const FORGE_SIDECAR_STARTED_MARKER = "self-update orchestrator started";

export const FORGE_UPDATE_SUCCESS_MARKER = "Update completed successfully";

export interface ForgeUpdateAvailabilityInput {
  runningCommitSha: string | null;
  remoteCommitSha: string | null;
  remoteCommitLookupFailed: boolean;
}

export interface ForgeUpdateAvailabilityResult {
  updateAvailable: boolean;
  /**
   * Whether a manual deploy may be started. Unlike `updateAvailable` (which is
   * only true when a *newer* commit exists), this is also true when Forge is
   * already up to date, so the user can redeploy the same commit on demand. It
   * is only false when we cannot determine a target commit (remote unreachable
   * or unknown).
   */
  deployAllowed: boolean;
  remoteCommitLookupFailed: boolean;
  reason:
    | "remote_unavailable"
    | "first_release"
    | "new_commit"
    | "up_to_date"
    | "unknown_remote";
}

export function computeForgeUpdateAvailability(
  input: ForgeUpdateAvailabilityInput,
): ForgeUpdateAvailabilityResult {
  if (input.remoteCommitLookupFailed) {
    return {
      updateAvailable: false,
      deployAllowed: false,
      remoteCommitLookupFailed: true,
      reason: "remote_unavailable",
    };
  }

  if (!input.remoteCommitSha) {
    return {
      updateAvailable: false,
      deployAllowed: false,
      remoteCommitLookupFailed: false,
      reason: "unknown_remote",
    };
  }

  if (!input.runningCommitSha) {
    return {
      updateAvailable: true,
      deployAllowed: true,
      remoteCommitLookupFailed: false,
      reason: "first_release",
    };
  }

  if (input.runningCommitSha !== input.remoteCommitSha) {
    return {
      updateAvailable: true,
      deployAllowed: true,
      remoteCommitLookupFailed: false,
      reason: "new_commit",
    };
  }

  return {
    updateAvailable: false,
    deployAllowed: true,
    remoteCommitLookupFailed: false,
    reason: "up_to_date",
  };
}

export function forgeUpdateUnavailableMessage(
  availability: ForgeUpdateAvailabilityResult,
  runningCommitSha: string | null,
  remoteCommitSha: string | null,
): string {
  switch (availability.reason) {
    case "remote_unavailable":
      return "Could not reach GitHub to check for updates. Verify network access and try again.";
    case "up_to_date": {
      const sha = (runningCommitSha ?? remoteCommitSha)?.slice(0, 7) ?? "unknown";
      return `Already running the latest commit (${sha})`;
    }
    case "unknown_remote":
      return "No update is available from the configured repository";
    default:
      return "No update is available from the configured repository";
  }
}

export function classifyForgeUpdateHttpError(message: string): number {
  if (
    /already in progress|updater container is already running/i.test(message)
  ) {
    return 409;
  }
  return 400;
}

export function sidecarHasStarted(
  logs: string,
  status: ForgeUpdateStatus,
): boolean {
  if (logs.includes(FORGE_SIDECAR_STARTED_MARKER)) {
    return true;
  }
  return status !== "pending";
}

export function isInProgressForgeUpdateStatus(
  status: ForgeUpdateStatus,
): boolean {
  return FORGE_IN_PROGRESS_STATUSES.includes(status);
}

export function defaultStaleUpdateErrorMessage(
  existing: string | null | undefined,
): string {
  return (
    existing ??
    "Update did not start or the updater container exited unexpectedly"
  );
}

export interface ForgeUpdateErrorView {
  status: string;
  errorMessage: string | null;
  startedAt: string;
}

/** Only surface failed-update banners when the latest terminal update failed. */
export function latestActionableFailedUpdate<
  T extends ForgeUpdateErrorView,
>(updates: T[]): T | undefined {
  if (updates.length === 0) return undefined;

  const latest = updates[0]!;
  if (latest.status === "success" || latest.status === "rolled_back") {
    return undefined;
  }
  if (latest.status === "failed" && latest.errorMessage) {
    return latest;
  }
  return undefined;
}

export function shouldDisplayUpdateError(
  status: string,
  errorMessage: string | null | undefined,
): boolean {
  if (!errorMessage) return false;
  if (status === "success") return false;
  return status === "failed" || status === "rolled_back";
}

export function parseTargetCommitFromUpdateLogs(
  logs: string,
): string | null {
  const match = logs.match(/Target commit: ([0-9a-f]{40})/i);
  return match?.[1] ?? null;
}

export function statusLabel(status: ForgeUpdateStatus | string): string {
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
    case "cutover":
      return "Deploying";
    case "health_check":
      return "Health check";
    case "success":
      return "Success";
    case "failed":
      return "Failed";
    case "rolled_back":
      return "Rolled back";
    default:
      return status;
  }
}

export function statusToneClass(status: ForgeUpdateStatus | string): string {
  switch (status) {
    case "success":
      return "text-emerald-400";
    case "failed":
      return "text-red-400";
    case "rolled_back":
      return "text-amber-400";
    default:
      return "text-amber-300";
  }
}
