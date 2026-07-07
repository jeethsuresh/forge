import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("docker-runtime helpers", () => {
  let previousDockerHost: string | undefined;
  let previousProject: string | undefined;
  let previousContainerName: string | undefined;
  let previousForgeDockerSocket: string | undefined;
  let tempDir: string | null = null;

  beforeEach(() => {
    previousDockerHost = process.env.DOCKER_HOST;
    previousProject = process.env.COMPOSE_PROJECT_NAME;
    previousContainerName = process.env.FORGE_CONTAINER_NAME;
    previousForgeDockerSocket = process.env.FORGE_DOCKER_SOCKET;
    delete process.env.DOCKER_HOST;
    delete process.env.FORGE_CONTAINER_NAME;
    delete process.env.FORGE_DOCKER_SOCKET;
    process.env.COMPOSE_PROJECT_NAME = "forge";
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    if (previousDockerHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = previousDockerHost;
    if (previousProject === undefined) delete process.env.COMPOSE_PROJECT_NAME;
    else process.env.COMPOSE_PROJECT_NAME = previousProject;
    if (previousContainerName === undefined) delete process.env.FORGE_CONTAINER_NAME;
    else process.env.FORGE_CONTAINER_NAME = previousContainerName;
    if (previousForgeDockerSocket === undefined) delete process.env.FORGE_DOCKER_SOCKET;
    else process.env.FORGE_DOCKER_SOCKET = previousForgeDockerSocket;
  });

  function mountWritableSocket(): string {
    tempDir = mkdtempSync(join(tmpdir(), "forge-docker-runtime-"));
    const socketPath = join(tempDir, "docker.sock");
    writeFileSync(socketPath, "");
    return socketPath;
  }

  it("prefers a writable mounted socket over configured TCP DOCKER_HOST", async () => {
    const socketPath = mountWritableSocket();
    process.env.FORGE_DOCKER_SOCKET = socketPath;
    process.env.DOCKER_HOST = "tcp://127.0.0.1:18765";
    const { dockerHostForRuntime } = await import("@/lib/docker-runtime");
    expect(dockerHostForRuntime()).toBe(`unix://${socketPath}`);
  });

  it("falls back to configured DOCKER_HOST when no socket is mounted", async () => {
    process.env.DOCKER_HOST = "tcp://127.0.0.1:18765";
    process.env.FORGE_DOCKER_SOCKET = "/tmp/missing-forge-docker.sock";
    const { dockerHostForRuntime } = await import("@/lib/docker-runtime");
    expect(dockerHostForRuntime()).toBe("tcp://127.0.0.1:18765");
  });

  it("falls back to the default podman API port", async () => {
    process.env.FORGE_DOCKER_SOCKET = "/tmp/missing-forge-docker.sock";
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
