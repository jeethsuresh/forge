import { execFile } from "child_process";
import { accessSync, constants, existsSync, readFileSync } from "fs";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DEFAULT_PODMAN_API_PORT = "18765";

function unixSocketHost(): string | null {
  const socket = containerDockerSocket();
  if (!isWritableSocket(socket)) return null;
  return `unix://${socket}`;
}

export function dockerHostForRuntime(): string {
  const socketHost = unixSocketHost();
  if (socketHost) return socketHost;

  const configured = process.env.DOCKER_HOST?.trim();
  if (configured) return configured;

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

async function dockerInfoReachable(host: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info"], {
      env: { ...process.env, DOCKER_HOST: host },
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function ensureDockerDaemon(): Promise<void> {
  const primary = dockerHostForRuntime();
  if (await dockerInfoReachable(primary)) {
    return;
  }

  const configured = process.env.DOCKER_HOST?.trim();
  const socketHost = unixSocketHost();
  if (configured && socketHost && configured !== socketHost) {
    if (await dockerInfoReachable(socketHost)) {
      return;
    }
  }

  const port = process.env.FORGE_PODMAN_API_PORT ?? DEFAULT_PODMAN_API_PORT;
  const tcpHost = `tcp://127.0.0.1:${port}`;
  if (primary !== tcpHost && (await dockerInfoReachable(tcpHost))) {
    return;
  }

  if (primary.startsWith("unix://") || socketHost) {
    throw new Error(
      `Cannot reach container runtime at ${primary}. Redeploy Forge with ./deploy.sh so the host socket is mounted.`,
    );
  }

  throw new Error(
    `Cannot connect to container runtime at ${primary}. Start podman API on the host with ./deploy.sh (port ${port}) or mount DOCKER_SOCKET into Forge.`,
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
