import { execFile } from "child_process";
import { accessSync, constants, existsSync, readFileSync } from "fs";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DEFAULT_PODMAN_API_PORT = "18765";

export function dockerHostForRuntime(): string {
  const configured = process.env.DOCKER_HOST?.trim();
  if (configured) return configured;

  const socket = containerDockerSocket();
  if (isWritableSocket(socket)) {
    return `unix://${socket}`;
  }

  const port = process.env.FORGE_PODMAN_API_PORT ?? DEFAULT_PODMAN_API_PORT;
  return `tcp://127.0.0.1:${port}`;
}

function isWritableSocket(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function containerDockerSocket(): string {
  return process.env.FORGE_DOCKER_SOCKET ?? "/var/run/docker.sock";
}

export function hostDockerSocket(): string {
  return process.env.DOCKER_SOCKET?.trim() || containerDockerSocket();
}

export function forgeDataVolumeName(): string {
  const project = process.env.COMPOSE_PROJECT_NAME?.trim() || "forge";
  return `${project}_forge-data`;
}

export function dockerExecEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DOCKER_HOST: dockerHostForRuntime(),
  };
}

export async function ensureDockerDaemon(): Promise<void> {
  try {
    await execFileAsync("docker", ["info"], {
      env: dockerExecEnv(),
      timeout: 10_000,
    });
    return;
  } catch {
    // fall through
  }

  const host = dockerHostForRuntime();
  if (host.startsWith("unix://")) {
    throw new Error(
      `Cannot reach container runtime at ${host}. Redeploy Forge with ./deploy.sh so the host socket is mounted.`,
    );
  }

  throw new Error(
    `Cannot connect to container runtime at ${host}. Start podman API on the host with ./deploy.sh (port ${process.env.FORGE_PODMAN_API_PORT ?? DEFAULT_PODMAN_API_PORT}) or mount DOCKER_SOCKET into Forge.`,
  );
}

export function readForgeContainerName(): string | null {
  const fromEnv = process.env.FORGE_CONTAINER_NAME?.trim();
  if (fromEnv) return fromEnv;

  const path = "/data/forge-container-name";
  if (!existsSync(path)) return null;
  const name = readFileSync(path, "utf8").trim();
  return name || null;
}

export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
