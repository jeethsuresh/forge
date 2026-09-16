import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, releasePins } from "@/lib/db/schema";
import {
  getReleasePin,
  reconcileSidecarReleaseFile,
  upsertReleasePin,
} from "@/lib/release-pins";

describe("release pins", () => {
  const projectId = randomUUID();

  afterEach(() => {
    db.delete(releasePins).where(eq(releasePins.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("upserts SQLite pins and reconciles sidecar JSON", () => {
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "pins",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/pins",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    upsertReleasePin({
      projectId,
      stableCommitSha: "aaa",
      imageTag: "forge-app:stable",
    });
    expect(getReleasePin(projectId)?.stableCommitSha).toBe("aaa");

    const dir = mkdtempSync(join(tmpdir(), "forge-pins-"));
    const path = join(dir, "forge-release.json");
    writeFileSync(
      path,
      JSON.stringify({
        stableCommitSha: "bbb",
        rollbackCommitSha: "aaa",
        stableImageTag: "forge-app:bbb",
      }),
    );
    try {
      const row = reconcileSidecarReleaseFile(projectId, path);
      expect(row?.stableCommitSha).toBe("bbb");
      expect(row?.rollbackCommitSha).toBe("aaa");
      expect(row?.imageTag).toBe("forge-app:bbb");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
