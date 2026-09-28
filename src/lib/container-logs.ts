import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { containerLogs, type ContainerLogRow } from "@/lib/db/schema";
import { dockerExecEnv } from "@/lib/docker-runtime";
import { getComposeContainerStatus, type ContainerInfo } from "@/lib/docker";

const execFileAsync = promisify(execFile);

export const CONTAINER_LOG_TAIL = 2000;
export const CONTAINER_LOG_MAX_CHARS = 100_000;

export type DockerRunResult = { stdout: string; stderr: string };
export type ContainerLogsDockerRunner = (
  args: string[],
) => Promise<DockerRunResult>;

export type InspectState = {
  Error?: string;
  ExitCode?: number;
  OOMKilled?: boolean;
  Status?: string;
};

export type ContainerLogView = {
  projectId: string;
  containerName: string;
  service: string;
  state: string;
  status: string;
  logs: string;
  inspectError: string | null;
  capturedAt: string;
  refreshed: boolean;
};

let dockerRunner: ContainerLogsDockerRunner | null = null;

export function setContainerLogsDockerRunner(
  runner: ContainerLogsDockerRunner | null,
): void {
  dockerRunner = runner;
}

async function defaultDockerRunner(args: string[]): Promise<DockerRunResult> {
  const { stdout, stderr } = await execFileAsync("docker", args, {
    maxBuffer: 10 * 1024 * 1024,
    env: dockerExecEnv(),
  });
  return { stdout, stderr };
}

function runDocker(args: string[]): Promise<DockerRunResult> {
  return (dockerRunner ?? defaultDockerRunner)(args);
}

export function sanitizeContainerLogs(raw: string): string {
  return raw
    .replace(/\bfos\.[A-Za-z0-9._-]+/g, "fos.[redacted]")
    .replace(/\bfgc\.[A-Za-z0-9._-]+/g, "fgc.[redacted]")
    .replace(/\bcrsr_[A-Za-z0-9._-]+/g, "crsr_[redacted]")
    .replace(
      /(CURSOR_API_KEY|FORGE_CURSOR_API_KEY|FORGE_OPS_API_TOKEN|FORGE_GIT_PASSWORD)=[^\s]+/gi,
      "$1=[redacted]",
    )
    .replace(/(Authorization:\s*Bearer)\s+\S+/gi, "$1 [redacted]");
}

export function formatContainerLogExcerpt(raw: string): string {
  const cleaned = sanitizeContainerLogs(raw);
  if (cleaned.length <= CONTAINER_LOG_MAX_CHARS) return cleaned;
  return cleaned.slice(-CONTAINER_LOG_MAX_CHARS);
}

export function formatInspectError(state: InspectState | null): string | null {
  if (!state) return null;
  const parts: string[] = [];
  const error = state.Error?.trim();
  if (error) parts.push(error);
  if (state.OOMKilled) parts.push("OOMKilled");
  const exit = state.ExitCode;
  if (typeof exit === "number" && exit !== 0) {
    parts.push(`ExitCode ${exit}`);
  }
  if (parts.length === 0) return null;
  const status = state.Status?.trim();
  if (status) parts.unshift(`Status: ${status}`);
  return parts.join("\n");
}

function tailLines(text: string, tail: number): string {
  if (tail <= 0) return text;
  const lines = text.split("\n");
  if (lines.length <= tail) return text;
  return lines.slice(-tail).join("\n");
}

export type UpsertContainerLogInput = {
  projectId: string;
  composeSlug: string;
  containerName: string;
  service: string;
  state: string;
  status: string;
  logs: string;
  inspectError: string | null;
  deploymentId: string | null;
};

export function upsertContainerLogSnapshot(
  input: UpsertContainerLogInput,
): ContainerLogRow {
  const now = new Date();
  const existing = db
    .select()
    .from(containerLogs)
    .where(
      and(
        eq(containerLogs.projectId, input.projectId),
        eq(containerLogs.containerName, input.containerName),
      ),
    )
    .get();

  const logs = formatContainerLogExcerpt(input.logs);
  if (existing) {
    db.update(containerLogs)
      .set({
        composeSlug: input.composeSlug,
        service: input.service,
        state: input.state,
        status: input.status,
        logs,
        inspectError: input.inspectError,
        deploymentId: input.deploymentId,
        capturedAt: now,
      })
      .where(eq(containerLogs.id, existing.id))
      .run();
    return db
      .select()
      .from(containerLogs)
      .where(eq(containerLogs.id, existing.id))
      .get()!;
  }

  const id = randomUUID();
  db.insert(containerLogs)
    .values({
      id,
      projectId: input.projectId,
      composeSlug: input.composeSlug,
      containerName: input.containerName,
      service: input.service,
      state: input.state,
      status: input.status,
      logs,
      inspectError: input.inspectError,
      deploymentId: input.deploymentId,
      capturedAt: now,
    })
    .run();

  return db.select().from(containerLogs).where(eq(containerLogs.id, id)).get()!;
}

export function getContainerLogSnapshot(
  projectId: string,
  containerName: string,
): ContainerLogRow | null {
  return (
    db
      .select()
      .from(containerLogs)
      .where(
        and(
          eq(containerLogs.projectId, projectId),
          eq(containerLogs.containerName, containerName),
        ),
      )
      .get() ?? null
  );
}

export function listContainerLogSnapshots(
  projectId: string,
): ContainerLogRow[] {
  return db
    .select()
    .from(containerLogs)
    .where(eq(containerLogs.projectId, projectId))
    .all();
}

async function inspectContainerState(
  containerName: string,
): Promise<InspectState | null> {
  try {
    const { stdout } = await runDocker([
      "inspect",
      "-f",
      "{{json .State}}",
      containerName,
    ]);
    const parsed = JSON.parse(stdout.trim()) as InspectState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function collectDockerContainerLogs(
  containerName: string,
): Promise<{ logs: string; inspectError: string | null }> {
  let raw = "";
  try {
    const { stdout, stderr } = await runDocker([
      "logs",
      "--tail",
      String(CONTAINER_LOG_TAIL),
      containerName,
    ]);
    raw = `${stdout}${stdout && stderr ? "\n" : ""}${stderr}`;
  } catch {
    raw = "";
  }

  const inspect = await inspectContainerState(containerName);
  const inspectError = formatInspectError(inspect);
  const excerpt = formatContainerLogExcerpt(raw);
  const logs = excerpt.trim()
    ? excerpt
    : inspectError
      ? formatContainerLogExcerpt(inspectError)
      : "";

  return { logs, inspectError };
}

export async function captureComposeContainerLogs(opts: {
  projectId: string;
  composeSlug: string;
  deploymentId?: string | null;
  containers: ContainerInfo[];
}): Promise<ContainerLogRow[]> {
  const rows: ContainerLogRow[] = [];
  for (const container of opts.containers) {
    const collected = await collectDockerContainerLogs(container.name);
    rows.push(
      upsertContainerLogSnapshot({
        projectId: opts.projectId,
        composeSlug: opts.composeSlug,
        containerName: container.name,
        service: container.service,
        state: container.state,
        status: container.status,
        logs: collected.logs,
        inspectError: collected.inspectError,
        deploymentId: opts.deploymentId ?? null,
      }),
    );
  }
  return rows;
}

export async function captureProjectComposeLogs(opts: {
  projectId: string;
  repoPath: string;
  composeSlug: string;
  deploymentId?: string | null;
}): Promise<ContainerLogRow[]> {
  let containers: ContainerInfo[] = [];
  try {
    containers = await getComposeContainerStatus(
      opts.repoPath,
      opts.composeSlug,
    );
  } catch {
    containers = [];
  }
  if (containers.length === 0) return [];
  return captureComposeContainerLogs({
    projectId: opts.projectId,
    composeSlug: opts.composeSlug,
    deploymentId: opts.deploymentId,
    containers,
  });
}

function toView(
  row: ContainerLogRow,
  tail: number,
  refreshed: boolean,
): ContainerLogView {
  const capturedAt =
    row.capturedAt instanceof Date
      ? row.capturedAt.toISOString()
      : new Date(row.capturedAt).toISOString();
  return {
    projectId: row.projectId,
    containerName: row.containerName,
    service: row.service,
    state: row.state,
    status: row.status,
    logs: tailLines(row.logs, tail),
    inspectError: row.inspectError,
    capturedAt,
    refreshed,
  };
}

export async function readProjectContainerLogs(opts: {
  projectId: string;
  repoPath: string;
  composeSlug: string;
  containerName: string;
  tail?: number;
  refresh?: boolean;
}): Promise<ContainerLogView | null> {
  const live = await getComposeContainerStatus(
    opts.repoPath,
    opts.composeSlug,
  ).catch(() => [] as ContainerInfo[]);
  const match = live.find((c) => c.name === opts.containerName);

  const refresh = Boolean(opts.refresh) || !getContainerLogSnapshot(
    opts.projectId,
    opts.containerName,
  );

  if (refresh && !match && !getContainerLogSnapshot(opts.projectId, opts.containerName)) {
    return null;
  }

  return getOrRefreshContainerLogs({
    projectId: opts.projectId,
    containerName: opts.containerName,
    composeSlug: opts.composeSlug,
    service: match?.service,
    state: match?.state,
    status: match?.status,
    tail: opts.tail,
    refresh: refresh && Boolean(match),
  });
}

export function parseContainerLogQuery(url: URL): {
  tail: number;
  refresh: boolean;
} {
  const tailRaw = Number(url.searchParams.get("tail") ?? "200");
  const tail = Number.isFinite(tailRaw)
    ? Math.min(Math.max(Math.floor(tailRaw), 1), CONTAINER_LOG_TAIL)
    : 200;
  const refreshParam = url.searchParams.get("refresh") ?? "0";
  const refresh = refreshParam === "1" || refreshParam === "true";
  return { tail, refresh };
}

export async function getOrRefreshContainerLogs(opts: {
  projectId: string;
  containerName: string;
  composeSlug?: string;
  service?: string;
  state?: string;
  status?: string;
  deploymentId?: string | null;
  tail?: number;
  refresh?: boolean;
}): Promise<ContainerLogView | null> {
  const tail = Math.min(Math.max(opts.tail ?? 200, 1), CONTAINER_LOG_TAIL);
  const existing = getContainerLogSnapshot(opts.projectId, opts.containerName);

  if (!opts.refresh) {
    return existing ? toView(existing, tail, false) : null;
  }

  const collected = await collectDockerContainerLogs(opts.containerName);
  const composeSlug = opts.composeSlug ?? existing?.composeSlug;
  if (!composeSlug) {
    return existing ? toView(existing, tail, false) : null;
  }

  const row = upsertContainerLogSnapshot({
    projectId: opts.projectId,
    composeSlug,
    containerName: opts.containerName,
    service: opts.service ?? existing?.service ?? "unknown",
    state: opts.state ?? existing?.state ?? "unknown",
    status: opts.status ?? existing?.status ?? "",
    logs: collected.logs,
    inspectError: collected.inspectError,
    deploymentId: opts.deploymentId ?? existing?.deploymentId ?? null,
  });
  return toView(row, tail, true);
}
