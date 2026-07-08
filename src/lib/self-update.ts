import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { desc, eq } from "drizzle-orm";
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
import { APP_DISPLAY_NAME } from "@/lib/app-name";

const execFileAsync = promisify(execFile);

const SOURCE_DIR = process.env.FORGE_SOURCE_DIR ?? "/data/forge-source";
const UPDATER_SCRIPT = "/usr/local/bin/forge-self-update.sh";
const IMAGE_NAME = process.env.FORGE_IMAGE_NAME ?? "forge-app";

function releaseStatePath(): string {
  return process.env.FORGE_RELEASE_STATE ?? "/data/forge-release.json";
}

let activeUpdateId: string | null = null;

const IN_PROGRESS_STATUSES: ForgeUpdateStatus[] = [
  "pending",
  "pulling",
  "building",
  "testing",
  "staging",
  "cutover",
  "health_check",
];

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
  updateAvailable: boolean;
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

export function isForgeUpdateInProgress(): boolean {
  return activeUpdateId !== null;
}

/** Mark orphaned in-progress updates failed when no updater container is running. */
export async function reconcileStaleForgeUpdates(): Promise<number> {
  if (await updaterContainerRunning()) {
    return 0;
  }

  const stale = db
    .select()
    .from(forgeUpdates)
    .all()
    .filter((row) => IN_PROGRESS_STATUSES.includes(row.status));

  if (stale.length === 0) {
    activeUpdateId = null;
    return 0;
  }

  for (const row of stale) {
    db.update(forgeUpdates)
      .set({
        status: "failed",
        errorMessage:
          row.errorMessage ??
          "Update did not start or the updater container exited unexpectedly",
        completedAt: new Date(),
      })
      .where(eq(forgeUpdates.id, row.id))
      .run();
  }

  activeUpdateId = null;
  return stale.length;
}

export async function getForgeStatus(): Promise<ForgeStatusView> {
  await reconcileStaleForgeUpdates();

  const config = getSelfRepoConfig();
  const releaseState = readReleaseState();
  const runningCommitSha = releaseState?.stableCommitSha ?? null;

  let remoteCommitSha: string | null = null;
  if (config) {
    try {
      remoteCommitSha = await getRemoteCommitSha(config.repo, config.branch);
    } catch {
      remoteCommitSha = null;
    }
  }

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

  const inProgressStatuses: ForgeUpdateStatus[] = IN_PROGRESS_STATUSES;

  let activeUpdate: ForgeUpdateView | null = null;
  if (activeRow && inProgressStatuses.includes(activeRow.status)) {
    activeUpdate = toUpdateView(activeRow);
  } else if (await updaterContainerRunning()) {
    const latest = db
      .select()
      .from(forgeUpdates)
      .orderBy(desc(forgeUpdates.startedAt))
      .limit(1)
      .get();
    if (latest && inProgressStatuses.includes(latest.status)) {
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

  const updateAvailable =
    !!remoteCommitSha &&
    !!runningCommitSha &&
    remoteCommitSha !== runningCommitSha;

  return {
    configured: config !== null,
    selfRepo: config?.repo ?? null,
    selfBranch: config?.branch ?? "main",
    runningCommitSha,
    remoteCommitSha,
    updateAvailable:
      updateAvailable || (!!remoteCommitSha && !runningCommitSha),
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

  // Always run the image-baked orchestrator; /data/forge-source may lag behind.
  args.push(imageRef, "bash", UPDATER_SCRIPT, "--update-id", updateId);
  if (options.rollback) {
    args.push("--rollback");
  }

  appendUpdateLog(updateId, "Spawning updater sidecar container…");

  await execFileAsync("docker", args, { env: dockerExecEnv() });

  const containerName = `forge-updater-${updateId.slice(0, 8)}`;
  appendUpdateLog(updateId, `Updater container ${containerName} created`);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const row = db
      .select({ logs: forgeUpdates.logs, status: forgeUpdates.status })
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, updateId))
      .get();

    if (row && row.logs.trim().length > 0) {
      return;
    }

    if (row && !IN_PROGRESS_STATUSES.includes(row.status as ForgeUpdateStatus)) {
      return;
    }

    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["ps", "--filter", `name=${containerName}`, "--format", "{{.Names}}"],
        { env: dockerExecEnv() },
      );
      if (stdout.trim()) {
        continue;
      }
    } catch {
      // fall through
    }

    if (attempt >= 3) {
      throw new Error("Updater container exited before writing logs");
    }
  }
}

async function assertCanStartUpdate(): Promise<void> {
  await reconcileStaleForgeUpdates();

  if (activeUpdateId) {
    throw new Error(`A ${APP_DISPLAY_NAME} update is already in progress`);
  }
  if (await updaterContainerRunning()) {
    throw new Error(`A ${APP_DISPLAY_NAME} updater container is already running`);
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
  if (!status.updateAvailable) {
    const running = status.runningCommitSha?.slice(0, 7);
    const remote = status.remoteCommitSha?.slice(0, 7);
    if (running && remote && running === remote) {
      throw new Error(`Already running the latest commit (${running})`);
    }
    throw new Error("No update is available from the configured repository");
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
