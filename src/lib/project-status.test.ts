import { describe, expect, it } from "vitest";
import { deriveRuntimeStatus } from "@/lib/project-status";
import type { ContainerInfo } from "@/lib/docker";

const baseOptions = {
  isDeploying: false,
  hasSuccessfulDeploy: true,
  hasComposeFile: true,
};

function container(state: string): ContainerInfo {
  return {
    name: "svc",
    service: "app",
    state,
    status: state,
    ports: "",
  };
}

describe("deriveRuntimeStatus", () => {
  it("returns deploying when a deployment is active", () => {
    expect(
      deriveRuntimeStatus([], { ...baseOptions, isDeploying: true }),
    ).toBe("deploying");
  });

  it("returns not_deployed without a successful deploy", () => {
    expect(
      deriveRuntimeStatus([], { ...baseOptions, hasSuccessfulDeploy: false }),
    ).toBe("not_deployed");
  });

  it("returns unknown when there is no compose file", () => {
    expect(
      deriveRuntimeStatus([], { ...baseOptions, hasComposeFile: false }),
    ).toBe("unknown");
  });

  it("returns stopped when no containers are running", () => {
    expect(
      deriveRuntimeStatus(
        [container("exited"), container("created")],
        baseOptions,
      ),
    ).toBe("stopped");
  });

  it("returns running when all containers are running", () => {
    expect(
      deriveRuntimeStatus(
        [container("running"), container("running")],
        baseOptions,
      ),
    ).toBe("running");
  });

  it("returns partial when some containers are running", () => {
    expect(
      deriveRuntimeStatus(
        [container("running"), container("exited")],
        baseOptions,
      ),
    ).toBe("partial");
  });
});
