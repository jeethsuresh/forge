import { execFile } from "child_process";
import { promisify } from "util";
import { dockerExecEnv } from "@/lib/docker-runtime";

const execFileAsync = promisify(execFile);

function firstExposedPort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null" || trimmed === "{}") return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const keys = Object.keys(parsed as Record<string, unknown>);
    for (const key of keys) {
      const match = /^(\d+)\//.exec(key);
      if (match) return Number(match[1]);
    }
  } catch {
    return null;
  }
  return null;
}

export async function inspectImageContainerPort(
  image: string,
  env: NodeJS.ProcessEnv = dockerExecEnv(),
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["image", "inspect", "--format", "{{json .Config.ExposedPorts}}", image],
      { env },
    );
    return firstExposedPort(stdout);
  } catch {
    return null;
  }
}
