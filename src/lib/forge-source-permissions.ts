import { execFile } from "child_process";
import { unlink, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import {
  dockerExecEnv,
  ensureDockerDaemon,
  forgeDataVolumeName,
} from "@/lib/docker-runtime";
import { forgeSourceDir } from "@/lib/forge-project";

const execFileAsync = promisify(execFile);

/** Probe whether the current process can create/delete files in `dir`. */
export async function isDirectoryWritable(dir: string): Promise<boolean> {
  const probe = join(dir, `.forge-write-probe-${process.pid}`);
  try {
    await writeFile(probe, "");
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Self-update sidecars run without userns keep-id. If they chown forge-source to
 * the sidecar's `node` user, ownership remaps through subordinate UIDs and the
 * keep-id app (recovery agents) cannot write `.git/FETCH_HEAD`.
 *
 * Repair by chowning to root inside a non-keep-id helper container (root there
 * maps to the host user, which is the keep-id `node` uid).
 */
export async function ensureForgeSourceWritableForAgents(): Promise<void> {
  const sourceDir = forgeSourceDir();
  const gitDir = join(sourceDir, ".git");
  if (await isDirectoryWritable(gitDir)) return;

  await ensureDockerDaemon();
  const volume = forgeDataVolumeName();
  const quoted = sourceDir.replace(/'/g, `'"'"'`);
  // Prefer the local Forge image (already present); fall back to busybox.
  const repairImage =
    process.env.FORGE_IMAGE_NAME != null
      ? `${process.env.FORGE_IMAGE_NAME}:stable`
      : "forge-app:stable";
  try {
    await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${volume}:/data`,
        "--entrypoint",
        "chown",
        repairImage,
        "-R",
        "0:0",
        sourceDir,
      ],
      { env: dockerExecEnv() },
    );
  } catch {
    await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${volume}:/data`,
        "docker.io/library/busybox:1.36",
        "sh",
        "-c",
        `chown -R 0:0 '${quoted}'`,
      ],
      { env: dockerExecEnv() },
    );
  }

  if (!(await isDirectoryWritable(gitDir))) {
    throw new Error(
      `Forge source at ${sourceDir} is not writable after ownership repair (git fetch would fail with Permission denied on FETCH_HEAD)`,
    );
  }
}
