import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { hostname } from "os";
import { promisify } from "util";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  forgeUpdates,
  type ForgeUpdate,
  type ForgeUpdateStatus,
  type ForgeUpdateTrigger,
} from "@/lib/db/schema";
import { getRemoteCommitSha, parseGithubRepo } from "@/lib/github";
import { resolveForgeHostMounts } from "@/lib/forge-host-mounts";

const execFileAsync = promisify(execFile);

const SOURCE_DIR = process.env.FORGE_SOURCE_DIR ?? "/data/forge-source";
const UPDATER_SCRIPT = "/usr/local/bin/forge-self-update.sh";
const IMAGE_NAME = process.env.FORGE_IMAGE_NAME ?? "forge-app";

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

async function imageExists(tag: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["image", "inspect", `${IMAGE_NAME}:${tag}`]);
    return true;
  } catch {
    return false;
  }
}

async function updaterContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "--filter",
      "name=forge-updater-",
      "--format",
      "{{.Names}}",
    ]);
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

export async function getForgeStatus(): Promise<ForgeStatusView> {
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

  const inProgressStatuses: ForgeUpdateStatus[] = [
    "pending",
    "pulling",
    "building",
    "testing",
    "staging",
    "cutover",
    "health_check",
  ];

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
  const dockerHost =
    process.env.DOCKER_HOST ?? "tcp://127.0.0.1:18765";
  const containerName = hostname();
  const imageRef = (await imageExists("stable"))
    ? `${IMAGE_NAME}:stable`
    : `${IMAGE_NAME}:latest`;

  const hostMounts = resolveForgeHostMounts();
  const cursorAgentDir = hostMounts.cursorAgentDir;
  const cursorConfigDir = hostMounts.cursorConfigDir;

  const args = [
    "run",
    "--rm",
    "-d",
    "--name",
    `forge-updater-${updateId.slice(0, 8)}`,
    "--network",
    "host",
    "--volumes-from",
    containerName,
    "-e",
    `DOCKER_HOST=${dockerHost}`,
    "-e",
    `FORGE_DB_PATH=${process.env.FORGE_DB_PATH ?? "/data/forge.db"}`,
    "-e",
    `FORGE_SELF_REPO=${process.env.FORGE_SELF_REPO ?? ""}`,
    "-e",
    `FORGE_SELF_BRANCH=${process.env.FORGE_SELF_BRANCH ?? "main"}`,
    "-e",
    `HOST_PORT=${process.env.PORT ?? process.env.HOST_PORT ?? "3000"}`,
    "-e",
    `FORGE_STAGING_PORT=${process.env.FORGE_STAGING_PORT ?? "3456"}`,
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

  const scriptPath = existsSync(`${SOURCE_DIR}/scripts/self-update.sh`)
    ? `${SOURCE_DIR}/scripts/self-update.sh`
    : UPDATER_SCRIPT;

  args.push(imageRef, "bash", scriptPath, "--update-id", updateId);
  if (options.rollback) {
    args.push("--rollback");
  }

  await execFileAsync("docker", args, { env: process.env });
}

async function assertCanStartUpdate(): Promise<void> {
  if (activeUpdateId) {
    throw new Error("A Forge update is already in progress");
  }
  if (await updaterContainerRunning()) {
    throw new Error("A Forge updater container is already running");
  }
  if (!getSelfRepoConfig()) {
    throw new Error(
      "FORGE_SELF_REPO is not configured. Set it in the environment to enable self-updates.",
    );
  }
}

export async function startForgeUpdate(): Promise<string> {
  await assertCanStartUpdate();

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
