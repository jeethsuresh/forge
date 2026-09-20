import { parse, stringify } from "yaml";

export const EDITABLE_SERVICE_KEYS = [
  "image",
  "build",
  "ports",
  "environment",
  "env_file",
  "volumes",
  "restart",
  "depends_on",
  "healthcheck",
  "command",
  "entrypoint",
  "networks",
  "extra_hosts",
] as const;

export type EditableServiceKey = (typeof EDITABLE_SERVICE_KEYS)[number];

const EDITABLE = new Set<string>(EDITABLE_SERVICE_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ComposeParseResult =
  | {
      ok: true;
      doc: Record<string, unknown>;
      services: Record<string, Record<string, unknown>>;
      warnings: string[];
    }
  | { ok: false; error: string };

export function parseComposeYaml(yamlText: string): ComposeParseResult {
  let parsed: unknown;
  try {
    parsed = parse(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid YAML";
    return { ok: false, error: message };
  }
  if (parsed == null) {
    parsed = {};
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Compose file must be a YAML mapping" };
  }
  const servicesRaw = parsed.services;
  const services: Record<string, Record<string, unknown>> = {};
  if (servicesRaw !== undefined) {
    if (!isRecord(servicesRaw)) {
      return { ok: false, error: "services must be a mapping" };
    }
    for (const [name, value] of Object.entries(servicesRaw)) {
      services[name] = isRecord(value) ? value : { value };
    }
  }
  const warnings: string[] = [];
  if (!services.app) {
    warnings.push(
      'No service named "app". Forge rollback image tagging expects an app service.',
    );
  }
  return { ok: true, doc: parsed, services, warnings };
}

export function viewOnlyServiceKeys(
  service: Record<string, unknown>,
): string[] {
  return Object.keys(service).filter((key) => !EDITABLE.has(key));
}

export function stringifyCompose(doc: unknown): string {
  const text = stringify(doc, { lineWidth: 0 });
  return text.endsWith("\n") ? text : `${text}\n`;
}
