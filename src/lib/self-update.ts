import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  forgeUpdates,
  type ForgeUpdate,
  type ForgeUpdateStatus,
  type ForgeUpdateTrigger,
} from "@/lib/db/schema";
import {
  containerDockerSocket,
  dockerExecEnv,
  dockerHostForRuntime,
  ensureDockerDaemon,
  forgeDataVolumeName,
  hostDockerSocket,
} from "@/lib/docker-runtime";
import { getRemoteCommitSha, parseGithubRepo } from "@/lib/github";
import { resolveForgeHostMounts } from "@/lib/forge-host-mounts";
import {
  computeForgeUpdateAvailability,
  defaultStaleUpdateErrorMessage,
  FORGE_UPDATE_SUCCESS_MARKER,
  forgeUpdateUnavailableMessage,
  isInProgressForgeUpdateStatus,
  parseTargetCommitFromUpdateLogs,
  sidecarHasStarted,
} from "@/lib/self-update-helpers";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

const execFileAsync = promisify(execFile);

const SOURCE_DIR = process.env.FORGE_SOURCE_DIR ?? "/data/forge-source";
const UPDATER_SCRIPT = "/usr/local/bin/forge-self-update.sh";
const IMAGE_NAME = process.env.FORGE_IMAGE_NAME ?? "forge-app";
const SIDECAR_START_ATTEMPTS = 40;
const SIDECAR_POLL_MS = 500;

function releaseStatePath(): string {
  return process.env.FORGE_RELEASE_STATE ?? "/data/forge-release.json";
}

let activeUpdateId: string | null = null;

export interface ForgeReleaseState {
  stableImageTag: string;
  rollbackImageTag: string;
  stableCommitSha: string;
  updatedAt: string;
}

export interface ForgeStatusView {
  configured: boolean;
  selfRepo: string | null;
  selfBranch: string;
  runningCommitSha: string | null;
  remoteCommitSha: string | null;
  remoteCommitLookupFailed: boolean;
  updateAvailable: boolean;
  deployAllowed: boolean;
  hasRollbackImage: boolean;
  releaseState: ForgeReleaseState | null;
  activeUpdate: ForgeUpdateView | null;
  recentUpdates: ForgeUpdateView[];
}

export interface ForgeUpdateView {
  id: string;
  status: ForgeUpdateStatus;
  trigger: ForgeUpdateTrigger;
  targetCommitSha: string | null;
  previousCommitSha: string | null;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

function readReleaseState(): ForgeReleaseState | null {
  const path = releaseStatePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ForgeReleaseState;
  } catch {
    return null;
  }
}

function toUpdateView(row: ForgeUpdate): ForgeUpdateView {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    targetCommitSha: row.targetCommitSha,
    previousCommitSha: row.previousCommitSha,
    logs: row.logs,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function appendUpdateLog(updateId: string, message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const row = db
    .select({ logs: forgeUpdates.logs })
    .from(forgeUpdates)
    .where(eq(forgeUpdates.id, updateId))
    .get();
  db.update(forgeUpdates)
    .set({ logs: (row?.logs ?? "") + line })
    .where(eq(forgeUpdates.id, updateId))
    .run();
}

function findInProgressUpdates(): ForgeUpdate[] {
  return db
    .select()
    .from(forgeUpdates)
    .all()
    .filter((row) => isInProgressForgeUpdateStatus(row.status));
}

async function imageExists(tag: string): Promise<boolean> {
  try {
    await execFileAsync(
      "docker",
      ["image", "inspect", `${IMAGE_NAME}:${tag}`],
      { env: dockerExecEnv() },
    );
    return true;
  } catch {
    return false;
  }
}

async function updaterContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        "name=forge-updater-",
        "--format",
        "{{.Names}}",
      ],
      { env: dockerExecEnv() },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function updaterContainerExists(name: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "--filter", `name=${name}`, "--format", "{{.Names}}"],
      { env: dockerExecEnv() },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function getSelfRepoConfig(): { repo: string; branch: string } | null {
  const rawRepo = process.env.FORGE_SELF_REPO?.trim();
  if (!rawRepo) return null;
  try {
    return {
      repo: parseGithubRepo(rawRepo),
      branch: process.env.FORGE_SELF_BRANCH?.trim() || "main",
    };
  } catch {
    return null;
  }
}

export async function isForgeUpdateInProgress(): Promise<boolean> {
  await reconcileStaleForgeUpdates();
  if (activeUpdateId) return true;
  if (await updaterContainerRunning()) return true;
  return findInProgressUpdates().length > 0;
}

/** Mark orphaned in-progress updates failed when no updater container is running. */
export async function reconcileStaleForgeUpdates(): Promise<number> {
  if (await updaterContainerRunning()) {
    return 0;
  }

  db.update(forgeUpdates)
    .set({ errorMessage: null })
    .where(
      and(eq(forgeUpdates.status, "success"), isNotNull(forgeUpdates.errorMessage)),
    )
    .run();

  const stale = findInProgressUpdates();

  if (stale.length === 0) {
    activeUpdateId = null;
    return 0;
  }

  let reconciled = 0;
  const releaseState = readReleaseState();

  for (const row of stale) {
    const logs = row.logs ?? "";

    if (logs.includes(FORGE_UPDATE_SUCCESS_MARKER)) {
      const target =
        row.targetCommitSha ?? parseTargetCommitFromUpdateLogs(logs);
      db.update(forgeUpdates)
        .set({
          status: "success",
          errorMessage: null,
          completedAt: new Date(),
          targetCommitSha: target,
        })
        .where(eq(forgeUpdates.id, row.id))
        .run();
      reconciled += 1;
      continue;
    }

    const target =
      row.targetCommitSha ?? parseTargetCommitFromUpdateLogs(logs);
    if (
      target &&
      releaseState?.stableCommitSha &&
      releaseState.stableCommitSha === target
    ) {
      db.update(forgeUpdates)
        .set({
          status: "success",
          errorMessage: null,
          completedAt: new Date(),
          targetCommitSha: target,
        })
        .where(eq(forgeUpdates.id, row.id))
        .run();
      reconciled += 1;
      continue;
    }

    db.update(forgeUpdates)
      .set({
        status: "failed",
        errorMessage: defaultStaleUpdateErrorMessage(row.errorMessage),
        completedAt: new Date(),
      })
      .where(eq(forgeUpdates.id, row.id))
      .run();
    reconciled += 1;
  }

  activeUpdateId = null;
  return reconciled;
}

export async function getForgeStatus(): Promise<ForgeStatusView> {
  await reconcileStaleForgeUpdates();

  const config = getSelfRepoConfig();
  const releaseState = readReleaseState();
  const runningCommitSha = releaseState?.stableCommitSha ?? null;

  let remoteCommitSha: string | null = null;
  let remoteCommitLookupFailed = false;
  if (config) {
    try {
      remoteCommitSha = await getRemoteCommitSha(config.repo, config.branch);
    } catch {
      remoteCommitSha = null;
      remoteCommitLookupFailed = true;
    }
  }

  const availability = computeForgeUpdateAvailability({
    runningCommitSha,
    remoteCommitSha,
    remoteCommitLookupFailed,
  });

  const activeRow = activeUpdateId
    ? db
        .select()
        .from(forgeUpdates)
        .where(eq(forgeUpdates.id, activeUpdateId))
        .get()
    : db
        .select()
        .from(forgeUpdates)
        .where(eq(forgeUpdates.status, "pending"))
        .orderBy(desc(forgeUpdates.startedAt))
        .limit(1)
        .get();

  let activeUpdate: ForgeUpdateView | null = null;
  if (activeRow && isInProgressForgeUpdateStatus(activeRow.status)) {
    activeUpdate = toUpdateView(activeRow);
  } else if (await updaterContainerRunning()) {
    const latest = db
      .select()
      .from(forgeUpdates)
      .orderBy(desc(forgeUpdates.startedAt))
      .limit(1)
      .get();
    if (latest && isInProgressForgeUpdateStatus(latest.status)) {
      activeUpdate = toUpdateView(latest);
      activeUpdateId = latest.id;
    }
  } else {
    activeUpdateId = null;
  }

  const recentUpdates = db
    .select()
    .from(forgeUpdates)
    .orderBy(desc(forgeUpdates.startedAt))
    .limit(10)
    .all()
    .map(toUpdateView);

  return {
    configured: config !== null,
    selfRepo: config?.repo ?? null,
    selfBranch: config?.branch ?? "main",
    runningCommitSha,
    remoteCommitSha,
    remoteCommitLookupFailed: availability.remoteCommitLookupFailed,
    updateAvailable: availability.updateAvailable,
    deployAllowed: availability.deployAllowed,
    hasRollbackImage: await imageExists("rollback"),
    releaseState,
    activeUpdate,
    recentUpdates,
  };
}

async function spawnUpdater(
  updateId: string,
  options: { rollback?: boolean },
): Promise<void> {
  await ensureDockerDaemon();

  const dockerHost = dockerHostForRuntime();
  const imageRef = (await imageExists("stable"))
    ? `${IMAGE_NAME}:stable`
    : `${IMAGE_NAME}:latest`;

  const hostMounts = resolveForgeHostMounts();
  const cursorAgentDir = hostMounts.cursorAgentDir;
  const cursorConfigDir = hostMounts.cursorConfigDir;

  const hostSocket = hostDockerSocket();

  const args = [
    "run",
    "--rm",
    "-d",
    "--name",
    `forge-updater-${updateId.slice(0, 8)}`,
    "--network",
    "host",
    "-v",
    `${forgeDataVolumeName()}:/data`,
    "-v",
    `${hostSocket}:${containerDockerSocket()}`,
    "-e",
    `DOCKER_HOST=${dockerHost}`,
    "-e",
    `DOCKER_SOCKET=${hostSocket}`,
    "-e",
    `FORGE_DOCKER_SOCKET=${containerDockerSocket()}`,
    "-e",
    `FORGE_RUN_AS_ROOT=1`,
    "-e",
    `FORGE_DB_PATH=${process.env.FORGE_DB_PATH ?? "/data/forge.db"}`,
    "-e",
    `FORGE_SELF_REPO=${process.env.FORGE_SELF_REPO ?? ""}`,
    "-e",
    `FORGE_SELF_BRANCH=${process.env.FORGE_SELF_BRANCH ?? "main"}`,
    "-e",
    `HOST_PORT=${process.env.PORT ?? process.env.HOST_PORT ?? "3000"}`,
    "-e",
    `FORGE_STAGING_PORT=${process.env.FORGE_STAGING_PORT ?? "3466"}`,
    "-e",
    `COMPOSE_PROJECT_NAME=${process.env.COMPOSE_PROJECT_NAME ?? "forge"}`,
    "-e",
    `FORGE_SOURCE_DIR=${SOURCE_DIR}`,
    "-e",
    `FORGE_HOST_MOUNTS_FILE=${process.env.FORGE_HOST_MOUNTS_FILE ?? "/data/forge-host-mounts.json"}`,
  ];

  if (cursorAgentDir) {
    args.push("-e", `FORGE_CURSOR_AGENT_DIR=${cursorAgentDir}`);
    args.push("-v", `${cursorAgentDir}:/opt/cursor-agent:ro,z`);
  }
  if (cursorConfigDir) {
    args.push("-e", `FORGE_CURSOR_CONFIG_DIR=${cursorConfigDir}`);
    args.push("-v", `${cursorConfigDir}:/opt/cursor-config:ro,z`);
  }

  args.push(imageRef, "bash", UPDATER_SCRIPT, "--update-id", updateId);
  if (options.rollback) {
    args.push("--rollback");
  }

  appendUpdateLog(updateId, "Spawning updater sidecar container…");

  await execFileAsync("docker", args, { env: dockerExecEnv() });

  const containerName = `forge-updater-${updateId.slice(0, 8)}`;
  appendUpdateLog(updateId, `Updater container ${containerName} created`);

  for (let attempt = 0; attempt < SIDECAR_START_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, SIDECAR_POLL_MS));

    const row = db
      .select({ logs: forgeUpdates.logs, status: forgeUpdates.status })
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, updateId))
      .get();

    if (!row) {
      throw new Error("Update record disappeared while starting the updater");
    }

    const status = row.status as ForgeUpdateStatus;
    if (!isInProgressForgeUpdateStatus(status)) {
      return;
    }

    if (sidecarHasStarted(row.logs, status)) {
      return;
    }

    const containerRunning = await updaterContainerExists(containerName);
    if (!containerRunning && attempt >= 5) {
      throw new Error(
        "Updater container exited before the orchestrator started. Check recent update logs for details.",
      );
    }
  }

  throw new Error(
    "Timed out waiting for the updater sidecar to start. It may still be running; check recent update logs.",
  );
}

async function assertCanStartUpdate(): Promise<void> {
  await reconcileStaleForgeUpdates();

  if (activeUpdateId) {
    throw new Error(`A ${APP_DISPLAY_NAME} update is already in progress`);
  }
  if (await updaterContainerRunning()) {
    throw new Error(`A ${APP_DISPLAY_NAME} updater container is already running`);
  }
  if (findInProgressUpdates().length > 0) {
    throw new Error("A Forge update is already in progress");
  }
  if (!getSelfRepoConfig()) {
    throw new Error(
      "FORGE_SELF_REPO is not configured. Set it in the environment to enable self-updates.",
    );
  }
}

export async function startForgeUpdate(): Promise<string> {
  await assertCanStartUpdate();

  const status = await getForgeStatus();
  const availability = computeForgeUpdateAvailability({
    runningCommitSha: status.runningCommitSha,
    remoteCommitSha: status.remoteCommitSha,
    remoteCommitLookupFailed: status.remoteCommitLookupFailed,
  });
  // Manual self-update is allowed even when already up to date (redeploy the
  // same commit); only block when we cannot determine a target commit.
  if (!availability.deployAllowed) {
    throw new Error(
      forgeUpdateUnavailableMessage(
        availability,
        status.runningCommitSha,
        status.remoteCommitSha,
      ),
    );
  }

  const updateId = randomUUID();
  activeUpdateId = updateId;

  db.insert(forgeUpdates)
    .values({
      id: updateId,
      status: "pending",
      trigger: "manual",
      logs: "",
      startedAt: new Date(),
    })
    .run();

  try {
    await spawnUpdater(updateId, { rollback: false });
  } catch (err) {
    activeUpdateId = null;
    const message = err instanceof Error ? err.message : "Failed to start updater";
    db.update(forgeUpdates)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(forgeUpdates.id, updateId))
      .run();
    throw new Error(message);
  }

  return updateId;
}

export async function startForgeRollback(): Promise<string> {
  await assertCanStartUpdate();

  if (!(await imageExists("rollback"))) {
    throw new Error("No rollback image is available");
  }

  const updateId = randomUUID();
  activeUpdateId = updateId;

  db.insert(forgeUpdates)
    .values({
      id: updateId,
      status: "pending",
      trigger: "rollback",
      logs: "",
      startedAt: new Date(),
    })
    .run();

  try {
    await spawnUpdater(updateId, { rollback: true });
  } catch (err) {
    activeUpdateId = null;
    const message = err instanceof Error ? err.message : "Failed to start rollback";
    db.update(forgeUpdates)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(forgeUpdates.id, updateId))
      .run();
    throw new Error(message);
  }

  return updateId;
}

export function getForgeHealthPayload(): { ok: true; commitSha: string | null } {
  const releaseState = readReleaseState();
  return {
    ok: true,
    commitSha: releaseState?.stableCommitSha ?? null,
  };
}

export {
  classifyForgeUpdateHttpError,
  computeForgeUpdateAvailability,
  forgeUpdateUnavailableMessage,
  sidecarHasStarted,
} from "@/lib/self-update-helpers";
