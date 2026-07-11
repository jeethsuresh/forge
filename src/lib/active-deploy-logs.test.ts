import { describe, expect, it } from "vitest";
import {
  deployStatusLabel,
  resolveActiveDeployLogView,
  resolveAgentSessionDeployLogView,
} from "@/lib/active-deploy-logs";

describe("resolveActiveDeployLogView", () => {
  it("returns active project deployment logs", () => {
    expect(
      resolveActiveDeployLogView({
        isForge: false,
        forgeTitle: "Forge update",
        deployments: [
          {
            id: "dep-1",
            status: "success",
            branch: "main",
            commitSha: "abc123",
            logs: "done",
            errorMessage: null,
            startedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "dep-2",
            status: "building",
            branch: "main",
            commitSha: null,
            logs: "building image",
            errorMessage: null,
            startedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        activeForgeUpdate: null,
      }),
    ).toMatchObject({
      title: "Deployment in progress",
      status: "building",
      logs: "building image",
      branch: "main",
    });
  });

  it("prefers forge active update when present", () => {
    expect(
      resolveActiveDeployLogView({
        isForge: true,
        forgeTitle: "Orchestrator update",
        deployments: [],
        activeForgeUpdate: {
          id: "upd-1",
          status: "testing",
          targetCommitSha: "def456",
          logs: "running tests",
          errorMessage: null,
          startedAt: "2026-01-02T00:00:00.000Z",
        },
      }),
    ).toMatchObject({
      title: "Orchestrator update",
      status: "testing",
      logs: "running tests",
      commitSha: "def456",
    });
  });

  it("returns null when nothing is deploying", () => {
    expect(
      resolveActiveDeployLogView({
        isForge: false,
        forgeTitle: "Forge update",
        deployments: [
          {
            id: "dep-1",
            status: "success",
            branch: "main",
            commitSha: "abc123",
            logs: "done",
            errorMessage: null,
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        activeForgeUpdate: null,
      }),
    ).toBeNull();
  });
});

describe("resolveAgentSessionDeployLogView", () => {
  it("returns logs while the session is deploying", () => {
    expect(
      resolveAgentSessionDeployLogView({
        sessionStatus: "deploying",
        deployment: {
          id: "dep-1",
          status: "building",
          branch: "feature",
          commitSha: null,
          logs: "running tests",
          errorMessage: null,
          startedAt: "2026-01-02T00:00:00.000Z",
        },
      }),
    ).toMatchObject({
      title: "Agent deployment",
      status: "building",
      logs: "running tests",
      branch: "feature",
    });
  });

  it("returns failed deployment logs for failed sessions", () => {
    expect(
      resolveAgentSessionDeployLogView({
        sessionStatus: "failed",
        deployment: {
          id: "dep-1",
          status: "failed",
          branch: "feature",
          commitSha: "abc123",
          logs: "health check failed",
          errorMessage: "Health check failed",
          startedAt: "2026-01-02T00:00:00.000Z",
        },
      }),
    ).toMatchObject({
      status: "failed",
      logs: "health check failed",
      errorMessage: "Health check failed",
    });
  });

  it("hides logs after a successful deploy completes", () => {
    expect(
      resolveAgentSessionDeployLogView({
        sessionStatus: "completed",
        deployment: {
          id: "dep-1",
          status: "success",
          branch: "feature",
          commitSha: "abc123",
          logs: "done",
          errorMessage: null,
          startedAt: "2026-01-02T00:00:00.000Z",
        },
      }),
    ).toBeNull();
  });
});

describe("deployStatusLabel", () => {
  it("labels common deploy statuses", () => {
    expect(deployStatusLabel("building")).toBe("Building");
    expect(deployStatusLabel("health_check")).toBe("Health check");
  });
});
