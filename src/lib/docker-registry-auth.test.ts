import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import {
  prepareRegistryDockerConfig,
  registryServerFromImage,
  withRegistryDockerConfig,
} from "./docker-registry-auth";

describe("registryServerFromImage", () => {
  it("defaults Hub names to docker.io", () => {
    expect(registryServerFromImage("nginx:latest")).toBe("docker.io");
  });

  it("uses ghcr host", () => {
    expect(registryServerFromImage("ghcr.io/org/app:1")).toBe("ghcr.io");
  });
});

describe("prepareRegistryDockerConfig", () => {
  it("is a no-op without credentials", async () => {
    const handle = await prepareRegistryDockerConfig({ IMAGE: "nginx" });
    expect(handle.extraEnv.DOCKER_CONFIG).toBeUndefined();
    handle.cleanup();
  });

  it("logs in with an isolated DOCKER_CONFIG and deletes it after", async () => {
    let seenDir = "";
    let seenPassword = "";
    const handle = await prepareRegistryDockerConfig(
      {
        IMAGE: "ghcr.io/org/app:1",
        FORGE_REGISTRY_USER: "user",
        FORGE_REGISTRY_PASSWORD: "s3cret",
      },
      async (args, env, password) => {
        seenDir = env.DOCKER_CONFIG ?? "";
        seenPassword = password;
        expect(args).toContain("ghcr.io");
        expect(args).toContain("--password-stdin");
        expect(existsSync(seenDir)).toBe(true);
      },
    );
    expect(handle.extraEnv.DOCKER_CONFIG).toBe(seenDir);
    expect(seenPassword).toBe("s3cret");
    expect(seenDir).toContain("forge-docker-config-");
    handle.cleanup();
    expect(existsSync(seenDir)).toBe(false);
  });

  it("cleans up after withRegistryDockerConfig", async () => {
    let dir = "";
    await withRegistryDockerConfig(
      {
        FORGE_REGISTRY_USER: "u",
        FORGE_REGISTRY_PASSWORD: "p",
        IMAGE: "nginx",
      },
      async (env) => {
        dir = env.DOCKER_CONFIG ?? "";
        expect(existsSync(dir)).toBe(true);
        return 1;
      },
      async () => {},
    );
    expect(dir).toBeTruthy();
    expect(existsSync(dir)).toBe(false);
  });
});
