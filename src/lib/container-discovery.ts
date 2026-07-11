import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import type { ContainerInfo } from "@/lib/docker";
import { ensureDockerDaemon, dockerExecEnv } from "@/lib/docker-runtime";
import { projectComposeSlug } from "@/lib/projects";

const execFileAsync = promisify(execFile);

const STARTUP_CACHE_TTL_MS = 60_000;

type PsRecord = Record<string, unknown>;

let discoveredByComposeProject = new Map<string, ContainerInfo[]>();

function composeProjectFromLabels(labels: unknown): string | null {
  if (!labels || typeof labels !== "object") return null;
  const map = labels as Record<string, string>;
  return (
    map["com.docker.compose.project"] ??
    map["io.podman.compose.project"] ??
    null
  );
}

function composeServiceFromLabels(labels: unknown): string | null {
  if (!labels || typeof labels !== "object") return null;
  const map = labels as Record<string, string>;
  return (
    map["com.docker.compose.service"] ??
    map["io.podman.compose.service"] ??
    null
  );
}

function formatPsPorts(ports: unknown): string {
  if (!Array.isArray(ports)) return "";

  return ports
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const port = entry as {
        host_port?: number;
        container_port?: number;
        protocol?: string;
      };
      if (!port.host_port) return "";
      const protocol = port.protocol ?? "tcp";
      return `${port.host_port}:${port.container_port}/${protocol}`;
    })
    .filter(Boolean)
    .join(", ");
}

export function normalizeDockerPsRecord(record: PsRecord): ContainerInfo | null {
  const composeProject = composeProjectFromLabels(record.Labels);
  if (!composeProject) return null;

  const namesField = record.Names;
  const name =
    typeof record.Name === "string"
      ? record.Name
      : Array.isArray(namesField) && typeof namesField[0] === "string"
        ? namesField[0]
        : "unknown";

  const service =
    typeof record.Service === "string"
      ? record.Service
      : composeServiceFromLabels(record.Labels) ?? "unknown";

  const state = typeof record.State === "string" ? record.State : "unknown";
  const status = typeof record.Status === "string" ? record.Status : "";

  return {
    name,
    service,
    state,
    status,
    ports: formatPsPorts(record.Ports),
  };
}

export function parseDockerPsJson(stdout: string): PsRecord[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is PsRecord =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      );
    }
    if (parsed !== null && typeof parsed === "object") {
      return [parsed as PsRecord];
    }
  } catch {
    // fall through to NDJSON
  }

  const records: PsRecord[] = [];
  for (const line of trimmed.split("\n")) {
    const row = line.trim();
    if (!row) continue;
    try {
      const parsed = JSON.parse(row) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as PsRecord);
      }
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

export function groupComposeContainersByProject(
  records: PsRecord[],
): Map<string, ContainerInfo[]> {
  const grouped = new Map<string, ContainerInfo[]>();

  for (const record of records) {
    const composeProject = composeProjectFromLabels(record.Labels);
    if (!composeProject) continue;

    const container = normalizeDockerPsRecord(record);
    if (!container) continue;

    const existing = grouped.get(composeProject) ?? [];
    existing.push(container);
    grouped.set(composeProject, existing);
  }

  for (const [project, containers] of grouped) {
    containers.sort((a, b) => a.service.localeCompare(b.service));
    grouped.set(project, containers);
  }

  return grouped;
}

export function getDiscoveredComposeContainers(
  composeProjectSlug: string,
): ContainerInfo[] {
  return discoveredByComposeProject.get(composeProjectSlug) ?? [];
}

export function setDiscoveredComposeContainers(
  byProject: Map<string, ContainerInfo[]>,
): void {
  discoveredByComposeProject = new Map(byProject);
}

export async function scanRunningComposeContainers(): Promise<
  Map<string, ContainerInfo[]>
> {
  await ensureDockerDaemon();
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "-a", "--format", "json"],
      { maxBuffer: 10 * 1024 * 1024, env: dockerExecEnv() },
    );
    return groupComposeContainersByProject(parseDockerPsJson(stdout));
  } catch {
    return new Map();
  }
}

export async function refreshProjectRuntimeFromRunningContainers(): Promise<{
  composeProjects: number;
  warmedProjects: number;
}> {
  const byProject = await scanRunningComposeContainers();
  discoveredByComposeProject = byProject;

  const { seedComposeContainerCache } = await import("@/lib/project-runtime-cache");

  let warmedProjects = 0;
  for (const project of db.select().from(projects).all()) {
    const slug = projectComposeSlug(project);
    const containers = byProject.get(slug) ?? [];
    if (containers.length > 0) {
      seedComposeContainerCache(project.id, containers, STARTUP_CACHE_TTL_MS);
      warmedProjects += 1;
    }
  }

  if (byProject.size > 0 || warmedProjects > 0) {
    console.log(
      `[forge] Container discovery found ${byProject.size} compose stack(s); warmed runtime cache for ${warmedProjects} project(s)`,
    );
  }

  return { composeProjects: byProject.size, warmedProjects };
}
