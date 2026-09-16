import { existsSync, readFileSync } from "fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { releasePins, type ReleasePin } from "@/lib/db/schema";

export type ReleasePinView = {
  projectId: string;
  stableCommitSha: string | null;
  rollbackCommitSha: string | null;
  imageTag: string | null;
  updatedAt: string;
};

export function forgeReleaseStatePath(): string {
  return process.env.FORGE_RELEASE_STATE ?? "/data/forge-release.json";
}

export type SidecarReleaseFile = {
  stableImageTag?: string;
  rollbackImageTag?: string;
  stableCommitSha?: string;
  rollbackCommitSha?: string;
  updatedAt?: string;
};

export function readSidecarReleaseFile(
  path = forgeReleaseStatePath(),
): SidecarReleaseFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SidecarReleaseFile;
  } catch {
    return null;
  }
}

export function getReleasePin(projectId: string): ReleasePin | null {
  return (
    db
      .select()
      .from(releasePins)
      .where(eq(releasePins.projectId, projectId))
      .get() ?? null
  );
}

export function upsertReleasePin(input: {
  projectId: string;
  stableCommitSha?: string | null;
  rollbackCommitSha?: string | null;
  imageTag?: string | null;
}): ReleasePin {
  const now = new Date();
  const existing = getReleasePin(input.projectId);
  if (existing) {
    db.update(releasePins)
      .set({
        stableCommitSha:
          input.stableCommitSha !== undefined
            ? input.stableCommitSha
            : existing.stableCommitSha,
        rollbackCommitSha:
          input.rollbackCommitSha !== undefined
            ? input.rollbackCommitSha
            : existing.rollbackCommitSha,
        imageTag:
          input.imageTag !== undefined ? input.imageTag : existing.imageTag,
        updatedAt: now,
      })
      .where(eq(releasePins.projectId, input.projectId))
      .run();
  } else {
    db.insert(releasePins)
      .values({
        projectId: input.projectId,
        stableCommitSha: input.stableCommitSha ?? null,
        rollbackCommitSha: input.rollbackCommitSha ?? null,
        imageTag: input.imageTag ?? null,
        updatedAt: now,
      })
      .run();
  }
  return getReleasePin(input.projectId)!;
}

/** Copy sidecar JSON (shell cutover working copy) into SQLite. */
export function reconcileSidecarReleaseFile(
  projectId: string,
  path = forgeReleaseStatePath(),
): ReleasePin | null {
  const file = readSidecarReleaseFile(path);
  if (!file) return getReleasePin(projectId);
  return upsertReleasePin({
    projectId,
    stableCommitSha: file.stableCommitSha ?? null,
    rollbackCommitSha: file.rollbackCommitSha ?? null,
    imageTag: file.stableImageTag ?? file.rollbackImageTag ?? null,
  });
}

export function releasePinView(row: ReleasePin): ReleasePinView {
  return {
    projectId: row.projectId,
    stableCommitSha: row.stableCommitSha,
    rollbackCommitSha: row.rollbackCommitSha,
    imageTag: row.imageTag,
    updatedAt: row.updatedAt.toISOString(),
  };
}
