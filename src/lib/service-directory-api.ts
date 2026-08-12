import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, type ServiceDirectoryRow } from "@/lib/db/schema";
import { listServiceDirectory } from "@/lib/service-directory";

export type ServiceDirectoryApiRow = {
  id: string;
  projectId: string;
  projectName: string;
  deployTarget: string;
  portName: string;
  port: number;
  public: boolean;
  subdomain: string | null;
  url: string | null;
  status: ServiceDirectoryRow["status"];
  routeStatus: ServiceDirectoryRow["routeStatus"];
  routeError: string | null;
  boundPort: number | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  deploymentId: string | null;
  commitSha: string | null;
  updatedAt: string;
};

function toIso(value: Date | number | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

export function serializeServiceDirectoryRow(
  row: ServiceDirectoryRow,
  projectName: string,
): ServiceDirectoryApiRow {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName,
    deployTarget: row.deployTarget,
    portName: row.portName,
    port: row.port,
    public: row.public,
    subdomain: row.subdomain,
    url: row.url,
    status: row.status,
    routeStatus: row.routeStatus,
    routeError: row.routeError,
    boundPort: row.boundPort,
    lastCheckedAt: toIso(row.lastCheckedAt),
    lastLatencyMs: row.lastLatencyMs,
    lastError: row.lastError,
    deploymentId: row.deploymentId,
    commitSha: row.commitSha,
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function listServiceDirectoryApi(opts?: {
  projectId?: string;
}): ServiceDirectoryApiRow[] {
  const rows = listServiceDirectory(
    opts?.projectId ? { projectId: opts.projectId } : undefined,
  );
  const nameById = new Map(
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .all()
      .map((p) => [p.id, p.name] as const),
  );

  return rows.map((row) =>
    serializeServiceDirectoryRow(
      row,
      nameById.get(row.projectId) ?? row.projectId,
    ),
  );
}

export function getProjectName(projectId: string): string | null {
  return (
    db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()?.name ?? null
  );
}
