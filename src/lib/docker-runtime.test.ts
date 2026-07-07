import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("docker-runtime helpers", () => {
  let previousDockerHost: string | undefined;
  let previousProject: string | undefined;
  let previousContainerName: string | undefined;

  beforeEach(() => {
    previousDockerHost = process.env.DOCKER_HOST;
    previousProject = process.env.COMPOSE_PROJECT_NAME;
    previousContainerName = process.env.FORGE_CONTAINER_NAME;
    delete process.env.DOCKER_HOST;
    delete process.env.FORGE_CONTAINER_NAME;
    process.env.COMPOSE_PROJECT_NAME = "forge";
  });

  afterEach(() => {
    if (previousDockerHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = previousDockerHost;
    if (previousProject === undefined) delete process.env.COMPOSE_PROJECT_NAME;
    else process.env.COMPOSE_PROJECT_NAME = previousProject;
    if (previousContainerName === undefined) delete process.env.FORGE_CONTAINER_NAME;
    else process.env.FORGE_CONTAINER_NAME = previousContainerName;
  });

  it("prefers configured DOCKER_HOST", async () => {
    process.env.DOCKER_HOST = "unix:///var/run/docker.sock";
    const { dockerHostForRuntime } = await import("@/lib/docker-runtime");
    expect(dockerHostForRuntime()).toBe("unix:///var/run/docker.sock");
  });

  it("falls back to the default podman API port", async () => {
    const { dockerHostForRuntime } = await import("@/lib/docker-runtime");
    expect(dockerHostForRuntime()).toBe("tcp://127.0.0.1:18765");
  });

  it("builds the forge data volume name from compose project", async () => {
    const { forgeDataVolumeName } = await import("@/lib/docker-runtime");
    expect(forgeDataVolumeName()).toBe("forge_forge-data");
  });

  it("reads the container name from env", async () => {
    process.env.FORGE_CONTAINER_NAME = "forge_app_1";
    const { readForgeContainerName } = await import("@/lib/docker-runtime");
    expect(readForgeContainerName()).toBe("forge_app_1");
  });
});
