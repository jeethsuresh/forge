import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  deployTargets,
  type ServiceDirectoryRow,
} from "@/lib/db/schema";
import type { ForgefilePort, ForgefilePortHealth } from "@/lib/forgefile-types";
import {
  listServiceDirectory,
  setServiceHealth,
} from "@/lib/service-directory";

const DEFAULT_HEALTH_INTERVAL_SECONDS = 30;
const DEFAULT_HEALTH_PATH = "/";
const PROBE_TIMEOUT_MS = 5_000;
const TICK_INTERVAL_MS = 10_000;

declare global {
  var __forgeServiceHealthStarted: boolean | undefined;
  var __forgeServiceHealthTimer: ReturnType<typeof setInterval> | undefined;
}

export type ServiceProbeTargetInput = {
  url: string | null;
  boundPort: number | null;
  port: number;
  healthPath: string;
};

export function resolveServiceProbeTarget(
  input: ServiceProbeTargetInput,
): string {
  const path = input.healthPath.startsWith("/")
    ? input.healthPath
    : `/${input.healthPath}`;

  if (input.url?.trim()) {
    const base = input.url.trim().replace(/\/+$/, "");
    return `${base}${path}`;
  }

  const hostPort = input.boundPort ?? input.port;
  return `http://127.0.0.1:${hostPort}${path}`;
}

function parsePortsJson(portsJson: string): ForgefilePort[] {
  try {
    const parsed = JSON.parse(portsJson) as unknown;
    return Array.isArray(parsed) ? (parsed as ForgefilePort[]) : [];
  } catch {
    return [];
  }
}

export function getPortHealthConfig(
  projectId: string,
  deployTarget: string,
  portName: string,
): ForgefilePortHealth | null {
  const target = db
    .select()
    .from(deployTargets)
    .where(
      and(
        eq(deployTargets.projectId, projectId),
        eq(deployTargets.name, deployTarget),
      ),
    )
    .get();
  if (!target) return null;
  const port = parsePortsJson(target.portsJson).find((p) => p.name === portName);
  return port?.health ?? null;
}

function shouldProbeRow(row: ServiceDirectoryRow): boolean {
  const health = getPortHealthConfig(
    row.projectId,
    row.deployTarget,
    row.portName,
  );
  if (health) return true;
  if (row.url?.trim()) return true;
  return false;
}

function intervalSecondsForRow(row: ServiceDirectoryRow): number {
  const health = getPortHealthConfig(
    row.projectId,
    row.deployTarget,
    row.portName,
  );
  const raw = health?.interval_seconds;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_HEALTH_INTERVAL_SECONDS;
}

function isDue(row: ServiceDirectoryRow, nowMs: number): boolean {
  if (!row.lastCheckedAt) return true;
  const last =
    row.lastCheckedAt instanceof Date
      ? row.lastCheckedAt.getTime()
      : Number(row.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= intervalSecondsForRow(row) * 1000;
}

export async function probeServiceHealth(
  row: ServiceDirectoryRow,
): Promise<void> {
  const health = getPortHealthConfig(
    row.projectId,
    row.deployTarget,
    row.portName,
  );
  const healthPath = health?.path?.trim() || DEFAULT_HEALTH_PATH;
  const targetUrl = resolveServiceProbeTarget({
    url: row.url,
    boundPort: row.boundPort,
    port: row.port,
    healthPath,
  });

  const started = Date.now();
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latency = Date.now() - started;
    if (res.ok) {
      setServiceHealth({
        projectId: row.projectId,
        deployTarget: row.deployTarget,
        portName: row.portName,
        status: "up",
        lastLatencyMs: latency,
        lastError: null,
      });
      return;
    }

    setServiceHealth({
      projectId: row.projectId,
      deployTarget: row.deployTarget,
      portName: row.portName,
      status: "down",
      lastLatencyMs: latency,
      lastError: `HTTP ${res.status}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setServiceHealth({
      projectId: row.projectId,
      deployTarget: row.deployTarget,
      portName: row.portName,
      status: "down",
      lastLatencyMs: Date.now() - started,
      lastError: message,
    });
  }
}

export async function runServiceHealthTick(): Promise<void> {
  const nowMs = Date.now();
  const rows = listServiceDirectory().filter(
    (row) => shouldProbeRow(row) && isDue(row, nowMs),
  );

  for (const row of rows) {
    await probeServiceHealth(row);
  }
}

export function startServiceHealthMonitor(): void {
  if (globalThis.__forgeServiceHealthStarted) return;
  globalThis.__forgeServiceHealthStarted = true;

  if (globalThis.__forgeServiceHealthTimer) {
    clearInterval(globalThis.__forgeServiceHealthTimer);
  }

  console.log(
    `[forge] Starting service health monitor (tick every ${TICK_INTERVAL_MS / 1000}s)`,
  );

  const tick = async () => {
    try {
      await runServiceHealthTick();
    } catch (err) {
      console.error("[forge] Service health tick failed:", err);
    }
  };

  void tick();
  globalThis.__forgeServiceHealthTimer = setInterval(tick, TICK_INTERVAL_MS);
}
