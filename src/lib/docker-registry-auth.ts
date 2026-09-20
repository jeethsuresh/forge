import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { dockerExecEnv } from "@/lib/docker-runtime";

export type RegistryLoginRunner = (
  args: string[],
  env: NodeJS.ProcessEnv,
  password: string,
) => Promise<void>;

function definedStrings(
  vars: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function registryServerFromImage(image: string | undefined): string {
  const trimmed = image?.trim() ?? "";
  if (!trimmed) return "docker.io";
  const namePart = trimmed.split("@")[0] ?? trimmed;
  const firstSlash = namePart.indexOf("/");
  if (firstSlash <= 0) return "docker.io";
  const maybeHost = namePart.slice(0, firstSlash);
  if (maybeHost.includes(".") || maybeHost.includes(":") || maybeHost === "localhost") {
    return maybeHost;
  }
  return "docker.io";
}

export type RegistryAuthHandle = {
  extraEnv: Record<string, string>;
  cleanup: () => void;
};

async function defaultDockerLogin(
  args: string[],
  env: NodeJS.ProcessEnv,
  password: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(password);
    child.stdin.end();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `docker login exited ${code}`));
    });
  });
}

/**
 * When registry user+password are present, log in using an isolated DOCKER_CONFIG
 * directory so projects cannot share host credentials.
 */
export async function prepareRegistryDockerConfig(
  vars: Record<string, string | undefined>,
  login: RegistryLoginRunner = defaultDockerLogin,
): Promise<RegistryAuthHandle> {
  const username = vars.FORGE_REGISTRY_USER?.trim() ?? "";
  const password = vars.FORGE_REGISTRY_PASSWORD ?? "";
  const merged = {
    ...dockerExecEnv(),
    ...definedStrings(vars),
  };

  if (!username || !password) {
    return { extraEnv: {}, cleanup: () => {} };
  }

  const dir = mkdtempSync(join(tmpdir(), "forge-docker-config-"));
  const extraEnv: Record<string, string> = { DOCKER_CONFIG: dir };
  const env = { ...merged, ...extraEnv };
  const server =
    vars.FORGE_REGISTRY_URL?.trim() || registryServerFromImage(vars.IMAGE);
  const args =
    !server || server === "docker.io"
      ? ["login", "--username", username, "--password-stdin"]
      : ["login", "--username", username, "--password-stdin", server];

  try {
    await login(args, env, password);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  return {
    extraEnv,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function withRegistryDockerConfig<T>(
  vars: Record<string, string | undefined>,
  run: (env: NodeJS.ProcessEnv) => Promise<T>,
  login?: RegistryLoginRunner,
): Promise<T> {
  const handle = await prepareRegistryDockerConfig(vars, login);
  const env = { ...dockerExecEnv(), ...definedStrings(vars), ...handle.extraEnv };
  try {
    return await run(env);
  } finally {
    handle.cleanup();
  }
}
