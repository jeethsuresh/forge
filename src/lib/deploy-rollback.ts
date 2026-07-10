import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";
import { composeAppContainerName, composeProjectName } from "@/lib/compose-project-name";
import {
  containerDockerSocket,
  dockerExecEnv,
  dockerHostForRuntime,
  ensureDockerDaemon,
  forgeDataVolumeName,
  hostDockerSocket,
  readForgeContainerName,
} from "@/lib/docker-runtime";
import { resolveForgeHostMounts } from "@/lib/forge-host-mounts";
import { forgeSourceDir, isForgeProject } from "@/lib/forge-project";
import { runScript } from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";
import { buildProjectScriptEnv, projectScriptArgs } from "@/lib/projects";
import type { Project } from "@/lib/db/schema";
import {
  composeDockerArgs,
  projectHasComposeFile,
  stopComposeProject,
} from "@/lib/docker";

const execFileAsync = promisify(execFile);
const dockerOpts = { env: dockerExecEnv() };

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"];
const HEALTH_RETRIES = Number(process.env.FORGE_HEALTH_RETRIES ?? "30");
const HEALTH_INTERVAL_MS = Number(process.env.FORGE_HEALTH_INTERVAL ?? "2") * 1000;
const FORGE_CUTOVER_SCRIPT = "/usr/local/bin/forge-production-cutover.sh";

export interface ProjectReleaseState {
  stableImageTag: string;
  rollbackImageTag: string;
  stableCommitSha: string;
  updatedAt: string;
}

export function projectImageName(project: Project): string {
  if (isForgeProject(project)) {
    return process.env.FORGE_IMAGE_NAME ?? "forge-app";
  }
  return `${composeProjectName(project.name)}-app`;
}

export function releaseStatePath(projectId: string): string {
  const base =
    process.env.FORGE_RELEASES_DIR ??
    join(dirname(process.env.FORGE_DB_PATH ?? "./data/forge.db"), "releases");
  return join(base, `${projectId}.json`);
}

function forgeReleaseStatePath(): string {
  return process.env.FORGE_RELEASE_STATE ?? "/data/forge-release.json";
}

function readReleaseStateFile(path: string): ProjectReleaseState | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProjectReleaseState;
  } catch {
    return null;
  }
}

export function stagingProjectName(composeSlug: string): string {
  return `${composeSlug}-staging`;
}

function findComposeFile(repoPath: string): string | null {
  return COMPOSE_FILES.find((f) => existsSync(join(repoPath, f))) ?? null;
}

export function readProjectReleaseState(
  projectId: string,
  project?: Project,
): ProjectReleaseState | null {
  if (project && isForgeProject(project)) {
    return readReleaseStateFile(forgeReleaseStatePath());
  }
  return readReleaseStateFile(releaseStatePath(projectId));
}

export function saveProjectReleaseState(
  projectId: string,
  commitSha: string,
  project?: Project,
): void {
  const state: ProjectReleaseState = {
    stableImageTag: "stable",
    rollbackImageTag: "rollback",
    stableCommitSha: commitSha,
    updatedAt: new Date().toISOString(),
  };
  const payload = JSON.stringify(state, null, 2);

  if (project && isForgeProject(project)) {
    const path = forgeReleaseStatePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, payload);
    return;
  }

  const path = releaseStatePath(projectId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, payload);
}

export async function dockerImageExists(
  imageName: string,
  tag: string,
): Promise<boolean> {
  try {
    await execFileAsync("docker", ["image", "inspect", `${imageName}:${tag}`], dockerOpts);
    return true;
  } catch {
    return false;
  }
}

export async function hasRollbackImage(project: Project): Promise<boolean> {
  return dockerImageExists(projectImageName(project), "rollback");
}

async function getComposeAppImageRef(
  repoPath: string,
  composeFile: string,
  composeSlug: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      composeDockerArgs(composeFile, composeSlug, "config", "--format", "json"),
      { cwd: repoPath, maxBuffer: 1024 * 1024, ...dockerOpts },
    );
    const config = JSON.parse(stdout.trim()) as {
      services?: { app?: { image?: string } };
    };
    const image = config.services?.app?.image?.trim();
    return image || null;
  } catch {
    return null;
  }
}

async function inspectDockerImageId(imageRef: string): Promise<string | null> {
  for (const ref of [imageRef, `localhost/${imageRef}`]) {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", ref],
        dockerOpts,
      );
      const id = stdout.trim();
      if (id) return id;
    } catch {
      // try next ref
    }
  }
  return null;
}

async function getComposeAppImageId(
  repoPath: string,
  composeFile: string,
  composeSlug: string,
): Promise<string | null> {
  const imageRef = await getComposeAppImageRef(
    repoPath,
    composeFile,
    composeSlug,
  );
  if (imageRef) {
    const fromRef = await inspectDockerImageId(imageRef);
    if (fromRef) return fromRef;
  }

  try {
    const { stdout } = await execFileAsync(
      "docker",
      composeDockerArgs(composeFile, composeSlug, "images", "-q", "app"),
      { cwd: repoPath, maxBuffer: 1024 * 1024, ...dockerOpts },
    );
    const id = stdout.trim().split("\n")[0]?.trim();
    if (id) return id;
  } catch {
    // fall through
  }

  return null;
}

export async function tagComposeAppImage(
  project: Project,
  tag: string,
  composeSlug: string,
): Promise<void> {
  const repoPath = resolveClonePath(project.clonePath);
  const composeFile = findComposeFile(repoPath);
  if (!composeFile) {
    throw new Error("No compose file found for image tagging");
  }

  const imageId = await getComposeAppImageId(repoPath, composeFile, composeSlug);
  if (!imageId) {
    const imageRef =
      (await getComposeAppImageRef(repoPath, composeFile, composeSlug)) ??
      "(unknown)";
    throw new Error(
      `Build did not produce an app image (project=${composeSlug}, image=${imageRef})`,
    );
  }

  const imageName = projectImageName(project);
  await execFileAsync("docker", ["tag", imageId, `${imageName}:${tag}`], dockerOpts);
}

export async function ensureRollbackImage(
  project: Project,
  composeSlug: string,
): Promise<boolean> {
  const imageName = projectImageName(project);
  if (await dockerImageExists(imageName, "rollback")) {
    return true;
  }
  if (await dockerImageExists(imageName, "stable")) {
    await execFileAsync("docker", [
      "tag",
      `${imageName}:stable`,
      `${imageName}:rollback`,
    ], dockerOpts);
    return true;
  }

  const repoPath = resolveClonePath(project.clonePath);
  const composeFile = findComposeFile(repoPath);
  if (!composeFile) return false;

  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        `label=com.docker.compose.project=${composeSlug}`,
        "--filter",
        "label=com.docker.compose.service=app",
        "-q",
      ],
      { maxBuffer: 1024 * 1024, ...dockerOpts },
    );
    const containerId = stdout.trim().split("\n")[0]?.trim();
    if (!containerId) return false;

    const { stdout: imageStdout } = await execFileAsync("docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      containerId,
    ], dockerOpts);
    const imageId = imageStdout.trim();
    if (!imageId) return false;

    await execFileAsync("docker", ["tag", imageId, `${imageName}:rollback`], dockerOpts);
    return true;
  } catch {
    return false;
  }
}

export function resolveHealthPath(project: Project): string {
  if (isForgeProject(project)) {
    return "/api/forge/health";
  }
  return process.env.DEPLOY_HEALTH_PATH ?? "/";
}

export function resolveStagingPort(scriptEnv: NodeJS.ProcessEnv): string {
  if (scriptEnv.STAGING_PORT) {
    return String(scriptEnv.STAGING_PORT);
  }
  if (scriptEnv.FORGE_STAGING_PORT) {
    return String(scriptEnv.FORGE_STAGING_PORT);
  }
  const hostPort = Number(scriptEnv.HOST_PORT ?? "3000");
  return String(hostPort + 466);
}

export async function waitForHealth(
  port: string,
  healthPath: string,
  log: (msg: string) => void,
  label: string,
): Promise<boolean> {
  const url = `http://127.0.0.1:${port}${healthPath}`;
  let lastDetail = "no response";

  for (let attempt = 1; attempt <= HEALTH_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        log(`${label} health check passed (attempt ${attempt})`);
        return true;
      }
      lastDetail = `HTTP ${response.status} ${response.statusText}`;
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }

    if (attempt === 1 || attempt % 5 === 0) {
      log(
        `${label} health check attempt ${attempt}/${HEALTH_RETRIES}: ${lastDetail} (${url})`,
      );
    }

    if (attempt < HEALTH_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
    }
  }

  log(
    `${label} health check failed after ${HEALTH_RETRIES} attempts (last: ${lastDetail}; url: ${url})`,
  );
  return false;
}

function withImageTagEnv(
  env: NodeJS.ProcessEnv,
  tag: string,
): NodeJS.ProcessEnv {
  return {
    ...env,
    DEPLOY_IMAGE_TAG: tag,
    FORGE_IMAGE_TAG: tag,
  };
}

async function teardownStaging(
  project: Project,
  stagingSlug: string,
): Promise<void> {
  try {
    await stopComposeProject(project.clonePath, stagingSlug);
  } catch {
    // best effort
  }
}

async function spawnForgeProductionCutoverSidecar(options: {
  composeSlug: string;
  scriptEnv: NodeJS.ProcessEnv;
  imageTag: string;
  commitSha?: string;
  log: (msg: string) => void;
}): Promise<void> {
  const { composeSlug, scriptEnv, imageTag, commitSha, log } = options;
  await ensureDockerDaemon();

  const imageName = process.env.FORGE_IMAGE_NAME ?? "forge-app";
  const imageRef = (await dockerImageExists(imageName, "stable"))
    ? `${imageName}:stable`
    : `${imageName}:latest`;
  const cutoverId = randomUUID().slice(0, 8);
  const containerName = `forge-cutover-${cutoverId}`;
  const dockerHost = dockerHostForRuntime();
  const hostSocket = hostDockerSocket();
  const hostPort = String(scriptEnv.HOST_PORT ?? "3000");
  const forgeContainerName =
    scriptEnv.FORGE_CONTAINER_NAME?.trim() ??
    readForgeContainerName() ??
    composeAppContainerName(composeSlug);

  const args = [
    "run",
    "--rm",
    "-d",
    "--name",
    containerName,
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
    `FORGE_IMAGE_TAG=${imageTag}`,
    "-e",
    `FORGE_IMAGE_NAME=${imageName}`,
    "-e",
    `HOST_PORT=${hostPort}`,
    "-e",
    `COMPOSE_PROJECT_NAME=${composeSlug}`,
    "-e",
    `FORGE_CONTAINER_NAME=${forgeContainerName}`,
    "-e",
    `FORGE_SOURCE_DIR=${forgeSourceDir()}`,
    "-e",
    `FORGE_RELEASE_STATE=${process.env.FORGE_RELEASE_STATE ?? "/data/forge-release.json"}`,
  ];

  if (commitSha) {
    args.push("-e", `FORGE_RELEASE_COMMIT_SHA=${commitSha}`);
  }

  const hostMounts = resolveForgeHostMounts();
  if (hostMounts.cursorAgentDir) {
    args.push("-e", `FORGE_CURSOR_AGENT_DIR=${hostMounts.cursorAgentDir}`);
    args.push("-v", `${hostMounts.cursorAgentDir}:/opt/cursor-agent:ro,z`);
  }
  if (hostMounts.cursorConfigDir) {
    args.push("-e", `FORGE_CURSOR_CONFIG_DIR=${hostMounts.cursorConfigDir}`);
    args.push("-v", `${hostMounts.cursorConfigDir}:/opt/cursor-config:ro,z`);
  }

  args.push(imageRef, "bash", FORGE_CUTOVER_SCRIPT);

  log(`Spawning production cutover sidecar ${containerName} (image tag ${imageTag})`);
  await execFileAsync("docker", args, dockerOpts);
  log(
    `Cutover sidecar ${containerName} started; production container will be recreated`,
  );
}

async function deployWithImageTag(
  project: Project,
  composeSlug: string,
  scriptEnv: NodeJS.ProcessEnv,
  scriptArgs: string[],
  imageTag: string,
  log: (msg: string) => void,
): Promise<void> {
  const repoPath = resolveClonePath(project.clonePath);
  const env = withImageTagEnv(scriptEnv, imageTag);
  if (isForgeProject(project)) {
    await spawnForgeProductionCutoverSidecar({
      composeSlug,
      scriptEnv: env,
      imageTag,
      log,
    });
    return;
  }
  log(`Deploying with image tag ${imageTag}`);
  await runScript("deploy.sh", repoPath, log, { env, args: scriptArgs });
}

export async function rollbackProduction(
  project: Project,
  composeSlug: string,
  scriptEnv: NodeJS.ProcessEnv,
  scriptArgs: string[],
  log: (msg: string) => void,
): Promise<boolean> {
  const imageName = projectImageName(project);
  if (!(await dockerImageExists(imageName, "rollback"))) {
    log("No rollback image available");
    return false;
  }

  log(`Rolling back to ${imageName}:rollback`);
  await deployWithImageTag(
    project,
    composeSlug,
    scriptEnv,
    scriptArgs,
    "rollback",
    log,
  );

  if (isForgeProject(project)) {
    log("Rollback cutover sidecar started; awaiting container restart");
    return true;
  }

  const healthPath = resolveHealthPath(project);
  const hostPort = String(scriptEnv.HOST_PORT ?? "3000");
  if (await waitForHealth(hostPort, healthPath, log, "Rollback")) {
    log("Rollback completed successfully");
    return true;
  }

  log("Rollback deploy started but health check failed");
  return false;
}

export async function promoteNextToStable(
  project: Project,
  commitSha: string,
): Promise<void> {
  const imageName = projectImageName(project);
  if (await dockerImageExists(imageName, "stable")) {
    await execFileAsync("docker", [
      "tag",
      `${imageName}:stable`,
      `${imageName}:rollback`,
    ], dockerOpts);
  }
  await execFileAsync("docker", ["tag", `${imageName}:next`, `${imageName}:stable`], dockerOpts);
  saveProjectReleaseState(project.id, commitSha, project);
}

export function projectSupportsRollback(project: Project): boolean {
  return projectHasComposeFile(project.clonePath);
}

export interface ComposeReleaseDeployContext {
  project: Project;
  commitSha: string;
  composeSlug: string;
  scriptEnv: NodeJS.ProcessEnv;
  scriptArgs: string[];
  log: (msg: string) => void;
}

export interface ComposeReleaseDeployOutcome {
  status: "success" | "rolled_back" | "failed" | "cutover_pending";
  reason?: string;
}

export async function runComposeReleaseDeploy(
  ctx: ComposeReleaseDeployContext,
): Promise<ComposeReleaseDeployOutcome> {
  const { project, commitSha, composeSlug, scriptEnv, scriptArgs, log } = ctx;
  const repoPath = resolveClonePath(project.clonePath);
  const stagingSlug = stagingProjectName(composeSlug);
  const stagingPort = resolveStagingPort(scriptEnv);
  const healthPath = resolveHealthPath(project);
  const hostPort = String(scriptEnv.HOST_PORT ?? "3000");

  try {
    log(`Tagging compose app image for project ${composeSlug}`);
    await tagComposeAppImage(project, "next", composeSlug);
    log(`Tagged ${projectImageName(project)}:next`);

    const stagingEnv = {
      ...withImageTagEnv(scriptEnv, "next"),
      HOST_PORT: stagingPort,
      COMPOSE_PROJECT_NAME: stagingSlug,
      PROJECT_NAME: stagingSlug,
      FORGE_CONTAINER_NAME: composeAppContainerName(stagingSlug),
    };
    const stagingArgs = projectScriptArgs(stagingSlug, stagingEnv);

    log(`Starting staging deploy on port ${stagingPort} (project ${stagingSlug})`);
    await runScript("deploy.sh", repoPath, log, {
      env: stagingEnv,
      args: [...stagingArgs, "--detach"],
    });

    if (!(await waitForHealth(stagingPort, healthPath, log, "Staging"))) {
      await teardownStaging(project, stagingSlug);
      const reason = `Staging health check failed on port ${stagingPort}${healthPath}`;
      log(`Release deploy aborted: ${reason}`);
      return { status: "failed", reason };
    }

    await teardownStaging(project, stagingSlug);
    log("Staging validation passed; tearing down staging containers");

    const hasRollback = await ensureRollbackImage(project, composeSlug);
    if (!hasRollback) {
      log(
        "Warning: could not snapshot rollback image; proceeding without rollback safety net",
      );
    }

    log(`Deploying new release to production port ${hostPort} (project ${composeSlug})`);
    if (isForgeProject(project)) {
      await spawnForgeProductionCutoverSidecar({
        composeSlug,
        scriptEnv,
        imageTag: "next",
        commitSha,
        log,
      });
      return { status: "cutover_pending" };
    }

    await deployWithImageTag(
      project,
      composeSlug,
      scriptEnv,
      scriptArgs,
      "next",
      log,
    );

    if (!(await waitForHealth(hostPort, healthPath, log, "Production"))) {
      log("Production health check failed; initiating rollback");
      const rolled = await rollbackProduction(
        project,
        composeSlug,
        scriptEnv,
        scriptArgs,
        log,
      );
      if (rolled) {
        const reason =
          `Production health check failed on port ${hostPort}${healthPath}; rolled back to previous release`;
        log(reason);
        return { status: "rolled_back", reason };
      }
      const reason =
        `Production health check failed on port ${hostPort}${healthPath} and rollback did not recover`;
      log(reason);
      return { status: "failed", reason };
    }

    await promoteNextToStable(project, commitSha);
    log("Release deploy completed successfully");
    return { status: "success" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR during release deploy: ${message}`);
    if (err instanceof Error && err.stack) {
      log(err.stack);
    }
    return { status: "failed", reason: message };
  }
}

export async function runProjectRollbackDeploy(
  project: Project,
  log: (msg: string) => void,
): Promise<boolean> {
  const { env: scriptEnv, composeProjectName: composeSlug } =
    buildProjectScriptEnv(project.name, project.deployEnvJson);
  const scriptArgs = projectScriptArgs(composeSlug, scriptEnv);

  const hasRollback = await ensureRollbackImage(project, composeSlug);
  if (!hasRollback) {
    throw new Error("No rollback image is available");
  }

  return rollbackProduction(
    project,
    composeSlug,
    scriptEnv,
    scriptArgs,
    log,
  );
}
