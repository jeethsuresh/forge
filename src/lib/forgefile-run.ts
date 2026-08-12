import { existsSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { isInlineRun } from "@/lib/forgefile-parse";
import type { Forgefile } from "@/lib/forgefile-types";
import {
  getProjectForgefile,
  listDeployTargets,
  projectForgefile,
  requireValidForgefile,
} from "@/lib/forgefile-project";
import { runScript } from "@/lib/github";
import { resolveClonePath } from "@/lib/paths";
import {
  buildProjectScriptEnv,
  projectScriptArgs,
} from "@/lib/projects";

/** Split a Forgefile `run` string on whitespace. Quoted args are not supported yet. */
export function splitRunCommand(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Forgefile run command is empty");
  }
  return trimmed.split(/\s+/);
}

export function resolveRunString(forgefile: Forgefile, value: string): string {
  if (isInlineRun(value)) return value;
  const script = forgefile.scripts[value];
  if (!script) {
    throw new Error(`Unknown script reference "${value}"`);
  }
  return script.run;
}

/**
 * Run a Forgefile command string in a checkout.
 * First token is a script path relative to cwd (must exist); remaining tokens
 * are prepended before Forge-injected `options.args` (`--project-name`, etc.).
 */
export async function runForgeCommand(
  command: string,
  cwd: string,
  onLog: (line: string) => void,
  options?: { env?: NodeJS.ProcessEnv; args?: string[] },
): Promise<void> {
  const tokens = splitRunCommand(command);
  const [scriptToken, ...commandArgs] = tokens;
  if (!scriptToken) {
    throw new Error("Forgefile run command is empty");
  }

  const scriptName = scriptToken.replace(/^\.\//, "");
  const resolvedCwd = resolveClonePath(cwd);
  const scriptPath = join(resolvedCwd, scriptName);
  if (!existsSync(scriptPath)) {
    throw new Error(`${scriptName} not found in repository root`);
  }

  const forgeArgs = options?.args ?? [];
  await runScript(scriptName, resolvedCwd, onLog, {
    env: options?.env,
    args: [...commandArgs, ...forgeArgs],
  });
}

export function resolveDeployTargetName(
  targetNames: string[],
  requested?: string | null,
): string {
  if (requested?.trim()) {
    const name = requested.trim();
    if (!targetNames.includes(name)) {
      throw new Error(
        `Unknown deployment target "${name}". Available: ${targetNames.join(", ") || "(none)"}`,
      );
    }
    return name;
  }

  if (targetNames.length === 1) {
    return targetNames[0]!;
  }

  if (targetNames.length === 0) {
    throw new Error("No deploy targets projected from Forgefile");
  }

  throw new Error(
    `Multiple deployment targets (${targetNames.join(", ")}); specify deployment`,
  );
}

export type DeployTargetScripts = {
  build?: string;
  test?: string;
  deploy: string;
  teardown?: string;
};

export function parseDeployTargetScripts(scriptsJson: string): DeployTargetScripts {
  const parsed = JSON.parse(scriptsJson) as DeployTargetScripts;
  if (!parsed || typeof parsed.deploy !== "string" || !parsed.deploy.trim()) {
    throw new Error("Deploy target is missing scripts.deploy");
  }
  return parsed;
}

export async function runNamedProjectScript(
  projectId: string,
  scriptName: string,
  onLog: (line: string) => void,
): Promise<void> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    throw new Error("Project not found");
  }

  const repoPath = resolveClonePath(project.clonePath);
  const projection = projectForgefile(projectId, repoPath);
  if (projection.status !== "valid") {
    requireValidForgefile(projectId);
  }

  const row = getProjectForgefile(projectId);
  if (!row || row.status !== "valid") {
    requireValidForgefile(projectId);
    return;
  }

  const forgefile = JSON.parse(row.parsedJson) as Forgefile;
  const script = forgefile.scripts[scriptName];
  if (!script) {
    throw new Error(`Script "${scriptName}" is not defined in Forgefile`);
  }

  const { env: scriptEnv, composeProjectName } = buildProjectScriptEnv(
    project.name,
    project.deployEnvJson,
    project.hostPort,
  );
  const scriptArgs = projectScriptArgs(composeProjectName, scriptEnv);

  await runForgeCommand(script.run, repoPath, onLog, {
    env: scriptEnv,
    args: scriptArgs,
  });
}

export function listAutoDeployTargetNames(projectId: string): string[] {
  return listDeployTargets(projectId)
    .filter((t) => t.autoDeploy)
    .map((t) => t.name);
}
