import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  serviceDirectory,
  type ServiceDirectoryRouteStatus,
  type ServiceDirectoryRow,
  type ServiceDirectoryStatus,
} from "@/lib/db/schema";

export type ServiceDirectoryKey = {
  deployTarget: string;
  portName: string;
};

export type UpsertDeclaredServiceInput = {
  projectId: string;
  deployTarget: string;
  portName: string;
  port: number;
  public: boolean;
  subdomain: string | null;
};

export type MarkServiceObservedInput = {
  projectId: string;
  deployTarget: string;
  portName: string;
  boundPort: number | null;
  deploymentId: string | null;
  commitSha: string | null;
  status: ServiceDirectoryStatus;
};

export type SetServiceHealthInput = {
  projectId: string;
  deployTarget: string;
  portName: string;
  status: ServiceDirectoryStatus;
  lastLatencyMs: number | null;
  lastError: string | null;
};

export type SetServiceRouteStatusInput = {
  projectId: string;
  deployTarget: string;
  portName: string;
  routeStatus: ServiceDirectoryRouteStatus;
  routeError: string | null;
  url?: string | null;
};

function findRow(
  projectId: string,
  deployTarget: string,
  portName: string,
): ServiceDirectoryRow | undefined {
  return db
    .select()
    .from(serviceDirectory)
    .where(
      and(
        eq(serviceDirectory.projectId, projectId),
        eq(serviceDirectory.deployTarget, deployTarget),
        eq(serviceDirectory.portName, portName),
      ),
    )
    .get();
}

export function listServiceDirectory(opts?: {
  projectId?: string;
}): ServiceDirectoryRow[] {
  if (opts?.projectId) {
    return db
      .select()
      .from(serviceDirectory)
      .where(eq(serviceDirectory.projectId, opts.projectId))
      .all();
  }
  return db.select().from(serviceDirectory).all();
}

export function upsertDeclaredService(
  input: UpsertDeclaredServiceInput,
): ServiceDirectoryRow {
  const now = new Date();
  const existing = findRow(
    input.projectId,
    input.deployTarget,
    input.portName,
  );

  if (existing) {
    db.update(serviceDirectory)
      .set({
        port: input.port,
        public: input.public,
        subdomain: input.subdomain,
        updatedAt: now,
      })
      .where(eq(serviceDirectory.id, existing.id))
      .run();
    return findRow(input.projectId, input.deployTarget, input.portName)!;
  }

  const id = randomUUID();
  db.insert(serviceDirectory)
    .values({
      id,
      projectId: input.projectId,
      deployTarget: input.deployTarget,
      portName: input.portName,
      port: input.port,
      public: input.public,
      subdomain: input.subdomain,
      url: null,
      status: "unknown",
      routeStatus: "none",
      routeError: null,
      boundPort: null,
      lastCheckedAt: null,
      lastLatencyMs: null,
      lastError: null,
      deploymentId: null,
      commitSha: null,
      updatedAt: now,
    })
    .run();

  return findRow(input.projectId, input.deployTarget, input.portName)!;
}

export function markServiceObserved(
  input: MarkServiceObservedInput,
): ServiceDirectoryRow | null {
  const existing = findRow(
    input.projectId,
    input.deployTarget,
    input.portName,
  );
  if (!existing) return null;

  const now = new Date();
  db.update(serviceDirectory)
    .set({
      boundPort: input.boundPort,
      deploymentId: input.deploymentId,
      commitSha: input.commitSha,
      status: input.status,
      updatedAt: now,
    })
    .where(eq(serviceDirectory.id, existing.id))
    .run();

  return findRow(input.projectId, input.deployTarget, input.portName)!;
}

export function setServiceHealth(
  input: SetServiceHealthInput,
): ServiceDirectoryRow | null {
  const existing = findRow(
    input.projectId,
    input.deployTarget,
    input.portName,
  );
  if (!existing) return null;

  const now = new Date();
  db.update(serviceDirectory)
    .set({
      status: input.status,
      lastLatencyMs: input.lastLatencyMs,
      lastError: input.lastError,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(serviceDirectory.id, existing.id))
    .run();

  return findRow(input.projectId, input.deployTarget, input.portName)!;
}

export function setServiceRouteStatus(
  input: SetServiceRouteStatusInput,
): ServiceDirectoryRow | null {
  const existing = findRow(
    input.projectId,
    input.deployTarget,
    input.portName,
  );
  if (!existing) return null;

  const now = new Date();
  const patch: {
    routeStatus: ServiceDirectoryRouteStatus;
    routeError: string | null;
    updatedAt: Date;
    url?: string | null;
  } = {
    routeStatus: input.routeStatus,
    routeError: input.routeError,
    updatedAt: now,
  };
  if (input.url !== undefined) {
    patch.url = input.url;
  }

  db.update(serviceDirectory)
    .set(patch)
    .where(eq(serviceDirectory.id, existing.id))
    .run();

  return findRow(input.projectId, input.deployTarget, input.portName)!;
}

export function removeStaleDeclaredServices(
  projectId: string,
  keepKeys: ServiceDirectoryKey[],
): void {
  const keep = new Set(
    keepKeys.map((k) => `${k.deployTarget}\0${k.portName}`),
  );
  const rows = listServiceDirectory({ projectId });
  for (const row of rows) {
    const key = `${row.deployTarget}\0${row.portName}`;
    if (!keep.has(key)) {
      db.delete(serviceDirectory)
        .where(eq(serviceDirectory.id, row.id))
        .run();
    }
  }
}

export function clearServiceDirectoryForProject(projectId: string): void {
  db.delete(serviceDirectory)
    .where(eq(serviceDirectory.projectId, projectId))
    .run();
}

/** Host port claimed by another directory row (any project). */
export function serviceDirectoryPortConflict(
  port: number,
  exclude?: { projectId: string; deployTarget: string; portName: string },
): ServiceDirectoryRow | null {
  const rows = listServiceDirectory();
  return (
    rows.find((row) => {
      if (row.port !== port) return false;
      if (
        exclude &&
        row.projectId === exclude.projectId &&
        row.deployTarget === exclude.deployTarget &&
        row.portName === exclude.portName
      ) {
        return false;
      }
      return true;
    }) ?? null
  );
}
