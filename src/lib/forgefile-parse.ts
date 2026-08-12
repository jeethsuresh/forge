import { parse as parseYaml } from "yaml";
import type {
  Forgefile,
  ForgefileDeployment,
  ForgefilePort,
  ForgefileScript,
  ForgefileValidationError,
} from "@/lib/forgefile-types";

export function isInlineRun(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.includes(" ");
}

export type ParseForgefileResult =
  | { ok: true; value: Forgefile }
  | { ok: false; errors: ForgefileValidationError[] };

function err(path: string, message: string): ForgefileValidationError {
  return { path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, path: string, errors: ForgefileValidationError[]): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(err(path, "must be a non-empty string"));
    return null;
  }
  return value;
}

function asOptionalString(
  value: unknown,
  path: string,
  errors: ForgefileValidationError[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    errors.push(err(path, "must be a string"));
    return undefined;
  }
  return value;
}

function asBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  return Boolean(value);
}

function asPortNumber(
  value: unknown,
  path: string,
  errors: ForgefileValidationError[],
): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(err(path, "must be an integer between 1 and 65535"));
    return null;
  }
  return value;
}

function validateScriptRef(
  value: string,
  path: string,
  scripts: Record<string, ForgefileScript>,
  errors: ForgefileValidationError[],
): void {
  if (isInlineRun(value)) return;
  if (!(value in scripts)) {
    errors.push(err(path, `unknown script reference "${value}"`));
  }
}

function parseScripts(
  raw: unknown,
  errors: ForgefileValidationError[],
): Record<string, ForgefileScript> {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) {
    errors.push(err("scripts", "must be an object"));
    return {};
  }

  const scripts: Record<string, ForgefileScript> = {};
  for (const [name, entry] of Object.entries(raw)) {
    const basePath = `scripts.${name}`;
    if (!isRecord(entry)) {
      errors.push(err(basePath, "must be an object"));
      continue;
    }
    const run = asString(entry.run, `${basePath}.run`, errors);
    if (!run) continue;
    const script: ForgefileScript = { run };
    const description = asOptionalString(entry.description, `${basePath}.description`, errors);
    if (description !== undefined) script.description = description;
    scripts[name] = script;
  }
  return scripts;
}

function parsePorts(
  raw: unknown,
  deploymentPath: string,
  errors: ForgefileValidationError[],
): ForgefilePort[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push(err(`${deploymentPath}.ports`, "must be an array"));
    return [];
  }

  const ports: ForgefilePort[] = [];
  raw.forEach((entry, index) => {
    const basePath = `${deploymentPath}.ports[${index}]`;
    if (!isRecord(entry)) {
      errors.push(err(basePath, "must be an object"));
      return;
    }
    const name = asString(entry.name, `${basePath}.name`, errors);
    const port = asPortNumber(entry.port, `${basePath}.port`, errors);
    if (!name || port === null) return;

    const portEntry: ForgefilePort = {
      name,
      port,
      public: asBoolean(entry.public, false),
    };

    if (entry.health !== undefined && entry.health !== null) {
      if (!isRecord(entry.health)) {
        errors.push(err(`${basePath}.health`, "must be an object"));
      } else {
        const healthPath = asString(entry.health.path, `${basePath}.health.path`, errors);
        if (healthPath) {
          const health: ForgefilePort["health"] = { path: healthPath };
          if (entry.health.interval_seconds !== undefined && entry.health.interval_seconds !== null) {
            if (
              typeof entry.health.interval_seconds !== "number" ||
              !Number.isInteger(entry.health.interval_seconds) ||
              entry.health.interval_seconds < 1
            ) {
              errors.push(
                err(`${basePath}.health.interval_seconds`, "must be a positive integer"),
              );
            } else {
              health.interval_seconds = entry.health.interval_seconds;
            }
          }
          portEntry.health = health;
        }
      }
    }

    ports.push(portEntry);
  });
  return ports;
}

function parseDeployments(
  raw: unknown,
  scripts: Record<string, ForgefileScript>,
  errors: ForgefileValidationError[],
): Record<string, ForgefileDeployment> {
  if (!isRecord(raw)) {
    errors.push(err("deployments", "must be an object"));
    return {};
  }

  const deployments: Record<string, ForgefileDeployment> = {};
  for (const [name, entry] of Object.entries(raw)) {
    const basePath = `deployments.${name}`;
    if (!isRecord(entry)) {
      errors.push(err(basePath, "must be an object"));
      continue;
    }

    if (!isRecord(entry.scripts)) {
      errors.push(err(`${basePath}.scripts`, "must be an object"));
      continue;
    }

    const deploy = asString(entry.scripts.deploy, `${basePath}.scripts.deploy`, errors);
    if (!deploy) continue;

    const deploymentScripts: ForgefileDeployment["scripts"] = { deploy };

    if (entry.scripts.build !== undefined && entry.scripts.build !== null) {
      const build =
        typeof entry.scripts.build === "string" ? entry.scripts.build : null;
      if (!build) {
        errors.push(err(`${basePath}.scripts.build`, "must be a string"));
      } else {
        validateScriptRef(build, `${basePath}.scripts.build`, scripts, errors);
        deploymentScripts.build = build;
      }
    }

    if (entry.scripts.test !== undefined && entry.scripts.test !== null) {
      const test =
        typeof entry.scripts.test === "string" ? entry.scripts.test : null;
      if (!test) {
        errors.push(err(`${basePath}.scripts.test`, "must be a string"));
      } else {
        validateScriptRef(test, `${basePath}.scripts.test`, scripts, errors);
        deploymentScripts.test = test;
      }
    }

    if (entry.scripts.teardown !== undefined && entry.scripts.teardown !== null) {
      const teardown =
        typeof entry.scripts.teardown === "string" ? entry.scripts.teardown : null;
      if (!teardown) {
        errors.push(err(`${basePath}.scripts.teardown`, "must be a string"));
      } else {
        deploymentScripts.teardown = teardown;
      }
    }

    const deployment: ForgefileDeployment = {
      auto_deploy: asBoolean(entry.auto_deploy, false),
      scripts: deploymentScripts,
      ports: parsePorts(entry.ports, basePath, errors),
    };

    const description = asOptionalString(entry.description, `${basePath}.description`, errors);
    if (description !== undefined) deployment.description = description;
    const subdomain = asOptionalString(entry.subdomain, `${basePath}.subdomain`, errors);
    if (subdomain !== undefined) deployment.subdomain = subdomain;
    const composeSlug = asOptionalString(entry.compose_slug, `${basePath}.compose_slug`, errors);
    if (composeSlug !== undefined) deployment.compose_slug = composeSlug;

    deployments[name] = deployment;
  }
  return deployments;
}

function validateUniquePorts(
  deployments: Record<string, ForgefileDeployment>,
  errors: ForgefileValidationError[],
): void {
  const seen = new Map<number, string>();
  for (const [deploymentName, deployment] of Object.entries(deployments)) {
    for (const portEntry of deployment.ports) {
      const existing = seen.get(portEntry.port);
      if (existing !== undefined) {
        errors.push(
          err(
            `deployments.${deploymentName}.ports`,
            `duplicate host port ${portEntry.port} (also used by deployment "${existing}")`,
          ),
        );
      } else {
        seen.set(portEntry.port, deploymentName);
      }
    }
  }
}

function parseArtifacts(
  raw: unknown,
  errors: ForgefileValidationError[],
): Forgefile["artifacts"] {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) {
    errors.push(err("artifacts", "must be an object"));
    return {};
  }

  const artifacts: Forgefile["artifacts"] = {};
  for (const [name, entry] of Object.entries(raw)) {
    const basePath = `artifacts.${name}`;
    if (!isRecord(entry)) {
      errors.push(err(basePath, "must be an object"));
      continue;
    }
    const build = asString(entry.build, `${basePath}.build`, errors);
    const path = asString(entry.path, `${basePath}.path`, errors);
    if (!build || !path) continue;
    const artifact: Forgefile["artifacts"][string] = { build, path };
    const description = asOptionalString(entry.description, `${basePath}.description`, errors);
    if (description !== undefined) artifact.description = description;
    const contentType = asOptionalString(entry.content_type, `${basePath}.content_type`, errors);
    if (contentType !== undefined) artifact.content_type = contentType;
    artifacts[name] = artifact;
  }
  return artifacts;
}

function parseAgent(raw: unknown, errors: ForgefileValidationError[]): Forgefile["agent"] {
  if (raw === undefined || raw === null) return { packages: [] };
  if (!isRecord(raw)) {
    errors.push(err("agent", "must be an object"));
    return { packages: [] };
  }
  if (raw.packages === undefined || raw.packages === null) return { packages: [] };
  if (!Array.isArray(raw.packages)) {
    errors.push(err("agent.packages", "must be an array"));
    return { packages: [] };
  }
  const packages: string[] = [];
  raw.packages.forEach((pkg, index) => {
    if (typeof pkg !== "string") {
      errors.push(err(`agent.packages[${index}]`, "must be a string"));
    } else {
      packages.push(pkg);
    }
  });
  return { packages };
}

export function parseForgefileYaml(source: string): ParseForgefileResult {
  const errors: ForgefileValidationError[] = [];

  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "invalid YAML";
    return { ok: false, errors: [err("", `YAML parse error: ${message}`)] };
  }

  if (!isRecord(doc)) {
    return { ok: false, errors: [err("", "Forgefile root must be an object")] };
  }

  if (doc.version !== 1) {
    errors.push(err("version", "version must be 1"));
  }

  if (!isRecord(doc.project)) {
    errors.push(err("project", "must be an object"));
    return { ok: false, errors };
  }

  const projectName = asString(doc.project.name, "project.name", errors);
  const composeSlug = asOptionalString(doc.project.compose_slug, "project.compose_slug", errors);

  const scripts = parseScripts(doc.scripts, errors);
  const deployments = parseDeployments(doc.deployments, scripts, errors);

  if (Object.keys(deployments).length === 0) {
    errors.push(err("deployments", "must contain at least one deployment"));
  }

  validateUniquePorts(deployments, errors);

  const artifacts = parseArtifacts(doc.artifacts, errors);
  const agent = parseAgent(doc.agent, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (!projectName) {
    return { ok: false, errors: [err("project.name", "must be a non-empty string")] };
  }

  const forgefile: Forgefile = {
    version: 1,
    project: {
      name: projectName,
      ...(composeSlug !== undefined ? { compose_slug: composeSlug } : {}),
    },
    scripts,
    deployments,
    artifacts,
    agent,
  };

  return { ok: true, value: forgefile };
}
