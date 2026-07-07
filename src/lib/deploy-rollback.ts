import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";
import { composeProjectName } from "@/lib/compose-project-name";
import { isForgeProject } from "@/lib/forge-project";
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

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"];
const HEALTH_RETRIES = Number(process.env.FORGE_HEALTH_RETRIES ?? "30");
const HEALTH_INTERVAL_MS = Number(process.env.FORGE_HEALTH_INTERVAL ?? "2") * 1000;

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

export function stagingProjectName(composeSlug: string): string {
  return `${composeSlug}-staging`;
}

function findComposeFile(repoPath: string): string | null {
  return COMPOSE_FILES.find((f) => existsSync(join(repoPath, f))) ?? null;
}

export function readProjectReleaseState(
  projectId: string,
): ProjectReleaseState | null {
  const path = releaseStatePath(projectId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProjectReleaseState;
  } catch {
    return null;
  }
}

export function saveProjectReleaseState(
  projectId: string,
  commitSha: string,
): void {
  const path = releaseStatePath(projectId);
  mkdirSync(join(path, ".."), { recursive: true });
  const state: ProjectReleaseState = {
    stableImageTag: "stable",
    rollbackImageTag: "rollback",
    stableCommitSha: commitSha,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export async function dockerImageExists(
  imageName: string,
  tag: string,
): Promise<boolean> {
  try {
    await execFileAsync("docker", ["image", "inspect", `${imageName}:${tag}`]);
    return true;
  } catch {
    return false;
  }
}

export async function hasRollbackImage(project: Project): Promise<boolean> {
  return dockerImageExists(projectImageName(project), "rollback");
}

async function getComposeAppImageId(
  repoPath: string,
  composeFile: string,
  composeSlug: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      composeDockerArgs(composeFile, composeSlug, "images", "-q", "app"),
      { cwd: repoPath, maxBuffer: 1024 * 1024 },
    );
    const id = stdout.trim().split("\n")[0]?.trim();
    return id || null;
  } catch {
    return null;
  }
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
    throw new Error("Build did not produce an app image");
  }

  const imageName = projectImageName(project);
  await execFileAsync("docker", ["tag", imageId, `${imageName}:${tag}`]);
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
    ]);
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
      { maxBuffer: 1024 * 1024 },
    );
    const containerId = stdout.trim().split("\n")[0]?.trim();
    if (!containerId) return false;

    const { stdout: imageStdout } = await execFileAsync("docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      containerId,
    ]);
    const imageId = imageStdout.trim();
    if (!imageId) return false;

    await execFileAsync("docker", ["tag", imageId, `${imageName}:rollback`]);
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
  const hostPort = Number(scriptEnv.HOST_PORT ?? "3000");
  return String(hostPort + 456);
}

export async function waitForHealth(
  port: string,
  healthPath: string,
  log: (msg: string) => void,
  label: string,
): Promise<boolean> {
  const url = `http://127.0.0.1:${port}${healthPath}`;
  for (let attempt = 1; attempt <= HEALTH_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        log(`${label} health check passed (attempt ${attempt})`);
        return true;
      }
    } catch {
      // retry
    }
    if (attempt < HEALTH_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
    }
  }
  log(`${label} health check failed after ${HEALTH_RETRIES} attempts`);
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
    ]);
  }
  await execFileAsync("docker", ["tag", `${imageName}:next`, `${imageName}:stable`]);
  saveProjectReleaseState(project.id, commitSha);
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

export async function runComposeReleaseDeploy(
  ctx: ComposeReleaseDeployContext,
): Promise<"success" | "rolled_back" | "failed"> {
  const { project, commitSha, composeSlug, scriptEnv, scriptArgs, log } = ctx;
  const repoPath = resolveClonePath(project.clonePath);
  const stagingSlug = stagingProjectName(composeSlug);
  const stagingPort = resolveStagingPort(scriptEnv);
  const healthPath = resolveHealthPath(project);
  const hostPort = String(scriptEnv.HOST_PORT ?? "3000");

  try {
    await tagComposeAppImage(project, "next", composeSlug);
    log("Tagged build as next release image");

    const stagingEnv = {
      ...withImageTagEnv(scriptEnv, "next"),
      HOST_PORT: stagingPort,
      COMPOSE_PROJECT_NAME: stagingSlug,
      PROJECT_NAME: stagingSlug,
    };
    const stagingArgs = projectScriptArgs(stagingSlug, stagingEnv);

    log(`Starting staging deploy on port ${stagingPort}`);
    await runScript("deploy.sh", repoPath, log, {
      env: stagingEnv,
      args: [...stagingArgs, "--detach"],
    });

    if (!(await waitForHealth(stagingPort, healthPath, log, "Staging"))) {
      await teardownStaging(project, stagingSlug);
      log("Staging health check failed; production was not changed");
      return "failed";
    }

    await teardownStaging(project, stagingSlug);

    const hasRollback = await ensureRollbackImage(project, composeSlug);
    if (!hasRollback) {
      log(
        "Warning: could not snapshot rollback image; proceeding without rollback safety net",
      );
    }

    log(`Deploying new release to production port ${hostPort}`);
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
      return rolled ? "rolled_back" : "failed";
    }

    await promoteNextToStable(project, commitSha);
    log("Release deploy completed successfully");
    return "success";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR during release deploy: ${message}`);
    return "failed";
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
