import { describe, expect, it } from "vitest";
import {
  classifyForgeUpdateHttpError,
  computeForgeUpdateAvailability,
  defaultStaleUpdateErrorMessage,
  forgeUpdateUnavailableMessage,
  latestActionableFailedUpdate,
  parseTargetCommitFromUpdateLogs,
  resolveForgeBranchDeployAllowed,
  shouldDisplayUpdateError,
  sidecarHasStarted,
  statusLabel,
  statusToneClass,
} from "@/lib/self-update-helpers";

describe("computeForgeUpdateAvailability", () => {
  it("reports unavailable when GitHub lookup failed", () => {
    expect(
      computeForgeUpdateAvailability({
        runningCommitSha: "abc123",
        remoteCommitSha: null,
        remoteCommitLookupFailed: true,
      }),
    ).toEqual({
      updateAvailable: false,
      deployAllowed: false,
      remoteCommitLookupFailed: true,
      reason: "remote_unavailable",
    });
  });

  it("reports first release when running commit is missing", () => {
    expect(
      computeForgeUpdateAvailability({
        runningCommitSha: null,
        remoteCommitSha: "abc123",
        remoteCommitLookupFailed: false,
      }),
    ).toEqual({
      updateAvailable: true,
      deployAllowed: true,
      remoteCommitLookupFailed: false,
      reason: "first_release",
    });
  });

  it("reports new commit when SHAs differ", () => {
    expect(
      computeForgeUpdateAvailability({
        runningCommitSha: "abc123",
        remoteCommitSha: "def456",
        remoteCommitLookupFailed: false,
      }),
    ).toMatchObject({
      updateAvailable: true,
      deployAllowed: true,
      reason: "new_commit",
    });
  });

  it("allows redeploying the same commit when up to date", () => {
    expect(
      computeForgeUpdateAvailability({
        runningCommitSha: "abc123",
        remoteCommitSha: "abc123",
        remoteCommitLookupFailed: false,
      }),
    ).toMatchObject({
      updateAvailable: false,
      deployAllowed: true,
      reason: "up_to_date",
    });
  });

  it("blocks deploy when remote SHA is unknown", () => {
    expect(
      computeForgeUpdateAvailability({
        runningCommitSha: "abc123",
        remoteCommitSha: null,
        remoteCommitLookupFailed: false,
      }),
    ).toMatchObject({
      updateAvailable: false,
      deployAllowed: false,
      reason: "unknown_remote",
    });
  });
});

describe("resolveForgeBranchDeployAllowed", () => {
  it("allows redeploy when a non-watch branch has a reachable remote tip", () => {
    expect(
      resolveForgeBranchDeployAllowed("feature/x", "main", {
        runningCommitSha: "abc123",
        remoteCommitSha: "def456",
        remoteCommitLookupFailed: false,
      }),
    ).toMatchObject({
      deployAllowed: true,
      updateAvailable: true,
    });
  });

  it("delegates to computeForgeUpdateAvailability for the watch branch", () => {
    expect(
      resolveForgeBranchDeployAllowed("main", "main", {
        runningCommitSha: "abc123",
        remoteCommitSha: "abc123",
        remoteCommitLookupFailed: false,
      }),
    ).toMatchObject({
      deployAllowed: true,
      updateAvailable: false,
      reason: "up_to_date",
    });
  });

  it("blocks non-watch redeploy when GitHub is unreachable", () => {
    expect(
      resolveForgeBranchDeployAllowed("feature/x", "main", {
        runningCommitSha: "abc123",
        remoteCommitSha: null,
        remoteCommitLookupFailed: true,
      }),
    ).toMatchObject({
      deployAllowed: false,
      reason: "remote_unavailable",
    });
  });
});

describe("forgeUpdateUnavailableMessage", () => {
  it("explains GitHub lookup failures", () => {
    const availability = computeForgeUpdateAvailability({
      runningCommitSha: "abc123",
      remoteCommitSha: null,
      remoteCommitLookupFailed: true,
    });
    expect(
      forgeUpdateUnavailableMessage(availability, "abc123", null),
    ).toMatch(/Could not reach GitHub/);
  });

  it("explains already up to date", () => {
    const availability = computeForgeUpdateAvailability({
      runningCommitSha: "abc1234567890",
      remoteCommitSha: "abc1234567890",
      remoteCommitLookupFailed: false,
    });
    expect(
      forgeUpdateUnavailableMessage(availability, "abc1234567890", "abc1234567890"),
    ).toBe("Already running the latest commit (abc1234)");
  });
});

describe("classifyForgeUpdateHttpError", () => {
  it("returns 409 for concurrent update errors", () => {
    expect(
      classifyForgeUpdateHttpError("A Forge update is already in progress"),
    ).toBe(409);
    expect(
      classifyForgeUpdateHttpError(
        "A Forge updater container is already running",
      ),
    ).toBe(409);
  });

  it("returns 400 for validation errors", () => {
    expect(
      classifyForgeUpdateHttpError("Already running the latest commit (abc1234)"),
    ).toBe(400);
    expect(classifyForgeUpdateHttpError("No rollback image is available")).toBe(
      400,
    );
  });
});

describe("sidecarHasStarted", () => {
  it("detects orchestrator startup marker", () => {
    expect(
      sidecarHasStarted(
        "[2026-07-07T00:00:00+00:00] Forge self-update orchestrator started (upgrade)",
        "pending",
      ),
    ).toBe(true);
  });

  it("detects status progression beyond pending", () => {
    expect(sidecarHasStarted("", "pulling")).toBe(true);
  });

  it("returns false for empty pending update", () => {
    expect(sidecarHasStarted("", "pending")).toBe(false);
  });
});

describe("defaultStaleUpdateErrorMessage", () => {
  it("preserves existing errors", () => {
    expect(defaultStaleUpdateErrorMessage("Build failed")).toBe("Build failed");
  });

  it("uses default when missing", () => {
    expect(defaultStaleUpdateErrorMessage(null)).toMatch(/updater container/i);
  });
});

describe("status helpers", () => {
  it("labels known statuses", () => {
    expect(statusLabel("cutover")).toBe("Deploying");
    expect(statusLabel("rolled_back")).toBe("Rolled back");
  });

  it("assigns tone classes", () => {
    expect(statusToneClass("success")).toContain("emerald");
    expect(statusToneClass("failed")).toContain("red");
  });
});

describe("latestActionableFailedUpdate", () => {
  it("hides failed banner after a newer success", () => {
    const failed = latestActionableFailedUpdate([
      {
        status: "success",
        errorMessage: "stale",
        startedAt: "2026-07-08T23:00:00Z",
      },
      {
        status: "failed",
        errorMessage: "real failure",
        startedAt: "2026-07-08T22:00:00Z",
      },
    ]);
    expect(failed).toBeUndefined();
  });

  it("shows failed banner when latest terminal update failed", () => {
    const failed = latestActionableFailedUpdate([
      {
        status: "failed",
        errorMessage: "real failure",
        startedAt: "2026-07-08T23:00:00Z",
      },
    ]);
    expect(failed?.errorMessage).toBe("real failure");
  });
});

describe("shouldDisplayUpdateError", () => {
  it("never shows errors on success rows", () => {
    expect(shouldDisplayUpdateError("success", "stale error")).toBe(false);
    expect(shouldDisplayUpdateError("failed", "real error")).toBe(true);
  });
});

describe("parseTargetCommitFromUpdateLogs", () => {
  it("extracts target commit sha from updater logs", () => {
    expect(
      parseTargetCommitFromUpdateLogs(
        "[2026-07-08T23:05:59+00:00] Target commit: 41e1c62b7c7ac0330677cc7e8aed6b4d56244745",
      ),
    ).toBe("41e1c62b7c7ac0330677cc7e8aed6b4d56244745");
  });
});
