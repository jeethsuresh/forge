import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveClonePath } from "@/lib/paths";

export interface DeployEnvVar {
  key: string;
  value: string;
  secret: boolean;
}

export interface DeployEnvVarInput {
  key: string;
  value: string;
  secret?: boolean;
  /** When true, a secret value was previously saved and left unchanged in the UI. */
  hasValue?: boolean;
}

export interface DeployEnvVarView {
  key: string;
  value: string;
  secret: boolean;
  hasValue: boolean;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_KEY_PATTERN =
  /(PASSWORD|SECRET|TOKEN|PRIVATE|API_KEY|CREDENTIAL|AUTH)/i;

export function inferSecretFromKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function parseEnvFile(content: string): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    let body = trimmed;
    if (body.startsWith("export ")) {
      body = body.slice("export ".length).trim();
    }

    const eq = body.indexOf("=");
    if (eq <= 0) continue;

    const key = body.slice(0, eq).trim();
    if (!isValidDeployEnvKey(key)) continue;

    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result.push({ key, value });
  }
  return result;
}

export function readRepoEnvFile(clonePath: string): {
  source: ".env" | ".env.example" | null;
  vars: DeployEnvVar[];
} {
  const root = resolveClonePath(clonePath);
  const envPath = join(root, ".env");
  const examplePath = join(root, ".env.example");

  let source: ".env" | ".env.example" | null = null;
  let content = "";

  if (existsSync(envPath)) {
    source = ".env";
    content = readFileSync(envPath, "utf8");
  } else if (existsSync(examplePath)) {
    source = ".env.example";
    content = readFileSync(examplePath, "utf8");
  } else {
    return { source: null, vars: [] };
  }

  const vars = parseEnvFile(content).map(({ key, value }) => ({
    key,
    value,
    secret: inferSecretFromKey(key),
  }));

  return { source, vars };
}

export function buildDeployEnvVarViews(
  saved: DeployEnvVar[],
  template: DeployEnvVar[],
  templateSource: ".env" | ".env.example" | null = null,
): DeployEnvVarView[] {
  if (saved.length === 0 && template.length === 0) {
    return [];
  }

  const savedByKey = new Map(
    saved.map((item) => [item.key.toUpperCase(), item] as const),
  );
  const templateByKey = new Map(
    template.map((item) => [item.key.toUpperCase(), item] as const),
  );

  const keyOrder: string[] = [];
  for (const item of template) {
    const upper = item.key.toUpperCase();
    if (!keyOrder.includes(upper)) keyOrder.push(upper);
  }
  for (const item of saved) {
    const upper = item.key.toUpperCase();
    if (!keyOrder.includes(upper)) keyOrder.push(upper);
  }

  return keyOrder.map((upper) => {
    const savedVar = savedByKey.get(upper);
    if (savedVar) {
      return {
        key: savedVar.key,
        value: savedVar.secret ? "" : savedVar.value,
        secret: savedVar.secret,
        hasValue: savedVar.value.length > 0,
      };
    }

    const templateVar = templateByKey.get(upper);
    if (!templateVar) {
      return {
        key: upper,
        value: "",
        secret: false,
        hasValue: false,
      };
    }

    return {
      key: templateVar.key,
      value:
        templateSource === ".env" && templateVar.secret ? "" : templateVar.value,
      secret: templateVar.secret,
      hasValue: templateVar.value.length > 0,
    };
  });
}

export function fillDeployEnvFromRepo(
  inputs: DeployEnvVarInput[],
  repoVars: DeployEnvVar[],
): DeployEnvVarInput[] {
  const repoByKey = new Map(
    repoVars.map((item) => [item.key.toUpperCase(), item] as const),
  );

  return inputs.map((input) => {
    if (input.value.trim()) return input;
    // Explicit clear — never import from repo .env
    if (input.hasValue === false) return input;
    // Only bootstrap masked secrets the user left unchanged (hasValue: true)
    if (input.hasValue !== true) return input;

    const repoVar = repoByKey.get(input.key.trim().toUpperCase());
    if (!repoVar?.value) return input;
    return { ...input, value: repoVar.value, hasValue: true };
  });
}

export function isValidDeployEnvKey(key: string): boolean {
  return ENV_KEY_PATTERN.test(key);
}

export function parseDeployEnvJson(raw: string | null | undefined): DeployEnvVar[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: DeployEnvVar[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const key = typeof record.key === "string" ? record.key.trim() : "";
      const value = typeof record.value === "string" ? record.value : "";
      const secret = Boolean(record.secret);
      if (!key || !isValidDeployEnvKey(key)) continue;
      result.push({ key, value, secret });
    }
    return result;
  } catch {
    return [];
  }
}

export function serializeDeployEnv(vars: DeployEnvVar[]): string {
  return JSON.stringify(vars);
}

export function deployEnvToRecord(vars: DeployEnvVar[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const item of vars) {
    env[item.key] = item.value;
  }
  return env;
}

export function mergeDeployEnvWithProcess(
  vars: DeployEnvVar[],
): NodeJS.ProcessEnv {
  return { ...process.env, ...deployEnvToRecord(vars) };
}

export function maskDeployEnvForClient(vars: DeployEnvVar[]): DeployEnvVarView[] {
  return vars.map((item) => ({
    key: item.key,
    value: item.secret ? "" : item.value,
    secret: item.secret,
    hasValue: item.secret ? item.value.length > 0 : item.value.length > 0,
  }));
}

export function validateDeployEnvInputs(
  inputs: DeployEnvVarInput[],
): string | null {
  const seen = new Set<string>();
  for (const item of inputs) {
    const key = item.key.trim();
    if (!key) continue;
    if (!isValidDeployEnvKey(key)) {
      return `Invalid environment variable name: ${key}`;
    }
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) {
      return `Duplicate environment variable: ${key}`;
    }
    seen.add(normalized);
  }
  return null;
}

export function resolveDeployEnvValue(
  input: DeployEnvVarInput,
  prior: DeployEnvVar | undefined,
): string {
  const trimmed = input.value.trim();
  if (trimmed) return input.value;

  if (input.hasValue === false) return "";

  if (prior?.value && input.hasValue === true) return prior.value;

  const secret = input.secret ?? prior?.secret ?? false;
  if (secret && prior?.value && input.hasValue === undefined) return prior.value;

  return "";
}

export function mergeDeployEnvUpdates(
  existing: DeployEnvVar[],
  inputs: DeployEnvVarInput[],
): DeployEnvVar[] {
  const existingByKey = new Map(
    existing.map((item) => [item.key.toUpperCase(), item] as const),
  );

  const result: DeployEnvVar[] = [];
  for (const input of inputs) {
    const key = input.key.trim();
    if (!key) continue;

    const prior = existingByKey.get(key.toUpperCase());
    const secret =
      input.secret ?? prior?.secret ?? inferSecretFromKey(key);
    const value = resolveDeployEnvValue(input, prior);

    result.push({ key, value, secret });
  }

  return result;
}
