import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { composeProjectName } from "@/lib/compose-project-name";
import {
  mergeDeployEnvWithProcess,
  parseDeployEnvJson,
} from "@/lib/deploy-env";

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
