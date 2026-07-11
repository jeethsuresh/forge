import { execFile, execFileSync } from "child_process";
import { accessSync, constants, existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

const execFileAsync = promisify(execFile);

const DEFAULT_PODMAN_API_PORT = "18765";

/** In-container path that skips unix-socket probes (avoids SELinux denials on bind mounts). */
export const SKIP_DOCKER_SOCKET_PROBE = "/data/.skip-docker-socket";

/** Bind-mount target for the host container socket (must stay outside /data). */
export const IN_CONTAINER_DOCKER_SOCK_MOUNT = "/var/run/docker.sock";

let cachedDockerHost: string | null = null;

function defaultTcpDockerHost(): string {
  const port = process.env.FORGE_PODMAN_API_PORT ?? DEFAULT_PODMAN_API_PORT;
  return `tcp://127.0.0.1:${port}`;
}

function socketProbeEnabled(): boolean {
  return process.env.FORGE_DOCKER_USE_SOCKET === "1";
}

function isReachableDockerHost(host: string): boolean {
  try {
    execFileSync("docker", ["info"], {
      env: { ...process.env, DOCKER_HOST: host },
      timeout: 5_000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function unixSocketHost(): string | null {
  const socket = containerDockerSocket();
  const host = `unix://${socket}`;
  if (!existsSync(socket)) return null;
  if (isReachableDockerHost(host)) return host;
  return null;
}

function resolveDockerHostWithoutCache(): string {
  if (socketProbeEnabled()) {
    const socketHost = unixSocketHost();
    if (socketHost) return socketHost;
  }

  const configured = process.env.DOCKER_HOST?.trim();
  if (configured) return configured;

  return defaultTcpDockerHost();
}

export function dockerHostForRuntime(): string {
  if (cachedDockerHost) return cachedDockerHost;
  return resolveDockerHostWithoutCache();
}

export function containerDockerSocket(): string {
  return process.env.FORGE_DOCKER_SOCKET ?? SKIP_DOCKER_SOCKET_PROBE;
}

export function inContainerDockerSocketMount(): string {
  return IN_CONTAINER_DOCKER_SOCK_MOUNT;
}

export function hostDockerSocket(): string {
  return process.env.DOCKER_SOCKET?.trim() || "/var/run/docker.sock";
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
  const primary = resolveDockerHostWithoutCache();
  if (await dockerInfoReachable(primary)) {
    cachedDockerHost = primary;
    return;
  }

  const configured = process.env.DOCKER_HOST?.trim();
  const tcpHost = defaultTcpDockerHost();

  if (primary !== tcpHost && (await dockerInfoReachable(tcpHost))) {
    cachedDockerHost = tcpHost;
    return;
  }

  if (socketProbeEnabled()) {
    const socketHost = unixSocketHost();
    if (socketHost && configured && socketHost !== configured) {
      if (await dockerInfoReachable(socketHost)) {
        cachedDockerHost = socketHost;
        return;
      }
    }
    if (socketHost) {
      if (await dockerInfoReachable(socketHost)) {
        cachedDockerHost = socketHost;
        return;
      }
    }
  }

  if (primary.startsWith("unix://")) {
    throw new Error(
      `Cannot reach container runtime at ${primary}. Redeploy ${APP_DISPLAY_NAME} with ./deploy.sh so the host socket is mounted, or use the Podman TCP API (port ${process.env.FORGE_PODMAN_API_PORT ?? DEFAULT_PODMAN_API_PORT}).`,
    );
  }

  throw new Error(
    `Cannot connect to container runtime at ${primary}. Start podman API on the host with ./deploy.sh (port ${process.env.FORGE_PODMAN_API_PORT ?? DEFAULT_PODMAN_API_PORT}) or set DOCKER_HOST to a reachable endpoint.`,
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
