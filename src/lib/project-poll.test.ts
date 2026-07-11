import { describe, expect, it } from "vitest";
import {
  deploymentRowForClient,
  isActiveDeploymentStatus,
} from "@/lib/project-poll";
import { mergePolledProjectDetail } from "@/lib/project-detail-client";

describe("project-poll", () => {
  it("detects active deployment statuses", () => {
    expect(isActiveDeploymentStatus("deploying")).toBe(true);
    expect(isActiveDeploymentStatus("success")).toBe(false);
  });

  it("strips logs for completed deployments in poll mode", () => {
    const row = {
      id: "d1",
      projectId: "p1",
      commitSha: null,
      branch: "main",
      status: "success",
      trigger: "manual",
      logs: "very long log output",
      errorMessage: null,
      startedAt: new Date(),
      completedAt: new Date(),
    };

    expect(
      deploymentRowForClient(row, { includeLogs: false }).logs,
    ).toBe("");
    expect(
      deploymentRowForClient(row, { includeLogs: false, }).status,
    ).toBe("success");
  });

  it("keeps logs for in-progress deployments", () => {
    const row = {
      id: "d2",
      projectId: "p1",
      commitSha: null,
      branch: "main",
      status: "building",
      trigger: "manual",
      logs: "building...",
      errorMessage: null,
      startedAt: new Date(),
      completedAt: null,
    };

    expect(
      deploymentRowForClient(row, { includeLogs: false }).logs,
    ).toBe("building...");
  });
});

describe("mergePolledProjectDetail", () => {
  it("preserves cached deployment logs across lightweight polls", () => {
    const previous = {
      deployments: [
        { id: "d1", status: "success", logs: "saved logs" },
      ],
    };
    const incoming = {
      deployments: [{ id: "d1", status: "success", logs: "" }],
    };

    expect(mergePolledProjectDetail(previous, incoming).deployments[0]?.logs).toBe(
      "saved logs",
    );
  });
});
