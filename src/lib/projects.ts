import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { composeProjectName } from "@/lib/compose-project-name";
import {
  mergeDeployEnvWithProcess,
  parseDeployEnvJson,
} from "@/lib/deploy-env";
import { getForgeRepoConfig } from "@/lib/forge-project";

export function validateProjectName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Project name is required";
  if (trimmed.length > 120) return "Project name is too long";
  return null;
}

export function composeNameConflict(
  name: string,
  excludeProjectId?: string,
): string | null {
  const slug = composeProjectName(name);
  const others = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .all();

  const conflict = others.find(
    (project) =>
      project.id !== excludeProjectId &&
      composeProjectName(project.name) === slug,
  );

  if (!conflict) return null;
  return `Another project (“${conflict.name}”) already uses compose name “${slug}”`;
}

function applyForgeInstanceScriptEnv(env: NodeJS.ProcessEnv): void {
  for (const key of [
    "COMPOSE_PROJECT_NAME",
    "FORGE_CONTAINER_NAME",
    "DOCKER_HOST",
    "DOCKER_SOCKET",
    "FORGE_CURSOR_AGENT_DIR",
    "FORGE_CURSOR_CONFIG_DIR",
    "FORGE_PODMAN_API_PORT",
    "HOST_PORT",
  ] as const) {
    const value = process.env[key]?.trim();
    if (value) {
      env[key] = value;
    }
  }
}

function isForgeScriptProject(projectName: string): boolean {
  return (
    getForgeRepoConfig() !== null && composeProjectName(projectName) === "forge"
  );
}

export function buildProjectScriptEnv(
  projectName: string,
  deployEnvJson: string,
): { env: NodeJS.ProcessEnv; composeProjectName: string } {
  const env = mergeDeployEnvWithProcess(parseDeployEnvJson(deployEnvJson));
  const slug = composeProjectName(projectName);
  if (!env.COMPOSE_PROJECT_NAME) {
    env.COMPOSE_PROJECT_NAME = slug;
  }
  if (!env.PROJECT_NAME) {
    env.PROJECT_NAME = slug;
  }
  if (isForgeScriptProject(projectName)) {
    applyForgeInstanceScriptEnv(env);
  }
  return { env, composeProjectName: slug };
}

/** CLI flags passed to build.sh, test.sh, deploy.sh, and teardown.sh. */
export function projectScriptArgs(
  composeSlug: string,
  env?: NodeJS.ProcessEnv,
): string[] {
  const args = ["--project-name", composeSlug];
  const hostPort = env?.HOST_PORT;
  if (hostPort) {
    args.push("--host-port", String(hostPort));
  }
  return args;
}
