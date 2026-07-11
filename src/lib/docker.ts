import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { getDiscoveredComposeContainers } from "@/lib/container-discovery";
import { dockerExecEnv } from "@/lib/docker-runtime";
import { resolveClonePath } from "@/lib/paths";

const execFileAsync = promisify(execFile);

export interface ContainerInfo {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
}

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"];

export { composeProjectName } from "@/lib/compose-project-name";

export function composeDockerArgs(
  composeFile: string,
  composeProjectSlug: string,
  ...subcommand: string[]
): string[] {
  return [
    "compose",
    "-f",
    composeFile,
    "-p",
    composeProjectSlug,
    ...subcommand,
  ];
}

function findComposeFile(repoPath: string): string | null {
  return COMPOSE_FILES.find((f) => existsSync(join(repoPath, f))) ?? null;
}

export function projectHasComposeFile(repoPath: string): boolean {
  return findComposeFile(resolveClonePath(repoPath)) !== null;
}

type ComposePsRecord = Record<string, unknown>;

function parseComposePsOutput(stdout: string): ComposePsRecord[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is ComposePsRecord =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      );
    }
    if (parsed !== null && typeof parsed === "object") {
      return [parsed as ComposePsRecord];
    }
  } catch {
    // fall through to NDJSON
  }

  const records: ComposePsRecord[] = [];
  for (const line of trimmed.split("\n")) {
    const row = line.trim();
    if (!row) continue;
    try {
      const parsed = JSON.parse(row) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as ComposePsRecord);
      }
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

function formatPorts(record: ComposePsRecord): string {
  const publishers = record.Publishers;
  if (Array.isArray(publishers)) {
    return publishers
      .map((p) => {
        if (p && typeof p === "object" && "URL" in p) {
          const url = (p as { URL?: string }).URL;
          return typeof url === "string" ? url : "";
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }

  const ports = record.Ports;
  if (!Array.isArray(ports)) return "";

  return ports
    .map((p) => {
      if (!p || typeof p !== "object") return "";
      const entry = p as {
        host_port?: number;
        container_port?: number;
        protocol?: string;
      };
      if (!entry.host_port) return "";
      const protocol = entry.protocol ?? "tcp";
      return `${entry.host_port}:${entry.container_port}/${protocol}`;
    })
    .filter(Boolean)
    .join(", ");
}

function normalizeContainer(record: ComposePsRecord): ContainerInfo | null {
  const nameField = record.Name;
  const namesField = record.Names;
  const name =
    typeof nameField === "string"
      ? nameField
      : Array.isArray(namesField) && typeof namesField[0] === "string"
        ? namesField[0]
        : null;

  const serviceField = record.Service;
  const labels = record.Labels;
  const labelService =
    labels && typeof labels === "object"
      ? ((labels as Record<string, string>)["com.docker.compose.service"] ??
        (labels as Record<string, string>)["io.podman.compose.service"])
      : undefined;
  const service =
    typeof serviceField === "string" ? serviceField : labelService ?? null;

  const state = typeof record.State === "string" ? record.State : null;
  const status = typeof record.Status === "string" ? record.Status : "";

  if (!name && !service && !state) return null;

  return {
    name: name ?? "unknown",
    service: service ?? "unknown",
    state: state ?? "unknown",
    status,
    ports: formatPorts(record),
  };
}

export async function getComposeContainerStatus(
  repoPath: string,
  composeProjectSlug: string,
): Promise<ContainerInfo[]> {
  const resolvedPath = resolveClonePath(repoPath);
  const composeFile = existsSync(resolvedPath)
    ? findComposeFile(resolvedPath)
    : null;

  if (composeFile) {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        composeDockerArgs(composeFile, composeProjectSlug, "ps", "--format", "json"),
        { cwd: resolvedPath, maxBuffer: 5 * 1024 * 1024, env: dockerExecEnv() },
      );

      const fromCompose = parseComposePsOutput(stdout)
        .map(normalizeContainer)
        .filter((c): c is ContainerInfo => c !== null);
      if (fromCompose.length > 0) {
        return fromCompose;
      }
    } catch {
      // Fall back to the startup container scan.
    }
  }

  return getDiscoveredComposeContainers(composeProjectSlug);
}

export async function stopComposeProject(
  repoPath: string,
  composeProjectSlug: string,
): Promise<string> {
  const resolvedPath = resolveClonePath(repoPath);
  if (!existsSync(resolvedPath)) {
    throw new Error("Project directory not found");
  }

  const composeFile = findComposeFile(resolvedPath);
  if (!composeFile) {
    throw new Error("No docker-compose file found in project");
  }

  const { stdout, stderr } = await execFileAsync(
    "docker",
    composeDockerArgs(composeFile, composeProjectSlug, "down", "--remove-orphans"),
    { cwd: resolvedPath, maxBuffer: 5 * 1024 * 1024 },
  );

  return (stdout + stderr).trim();
}
