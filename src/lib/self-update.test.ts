import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { forgeUpdates } from "@/lib/db/schema";

describe("getForgeHealthPayload", () => {
  let tempDir: string;
  let previousStatePath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "forge-health-"));
    previousStatePath = process.env.FORGE_RELEASE_STATE;
    process.env.FORGE_RELEASE_STATE = join(tempDir, "release.json");
  });

  afterEach(() => {
    if (previousStatePath === undefined) {
      delete process.env.FORGE_RELEASE_STATE;
    } else {
      process.env.FORGE_RELEASE_STATE = previousStatePath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns ok with null commit when release state is missing", async () => {
    const { getForgeHealthPayload } = await import("@/lib/self-update");
    expect(getForgeHealthPayload()).toEqual({ ok: true, commitSha: null });
  });

  it("returns stable commit from release state file", async () => {
    writeFileSync(
      process.env.FORGE_RELEASE_STATE!,
      JSON.stringify({
        stableImageTag: "stable",
        rollbackImageTag: "rollback",
        stableCommitSha: "abc123def456",
        updatedAt: "2026-07-07T00:00:00Z",
      }),
    );
    const { getForgeHealthPayload } = await import("@/lib/self-update");
    expect(getForgeHealthPayload()).toEqual({
      ok: true,
      commitSha: "abc123def456",
    });
  });
});

describe("getForgeStatus configuration", () => {
  let previousRepo: string | undefined;
  let previousBranch: string | undefined;

  beforeEach(() => {
    previousRepo = process.env.FORGE_SELF_REPO;
    previousBranch = process.env.FORGE_SELF_BRANCH;
  });

  afterEach(() => {
    if (previousRepo === undefined) {
      delete process.env.FORGE_SELF_REPO;
    } else {
      process.env.FORGE_SELF_REPO = previousRepo;
    }
    if (previousBranch === undefined) {
      delete process.env.FORGE_SELF_BRANCH;
    } else {
      process.env.FORGE_SELF_BRANCH = previousBranch;
    }
  });

  it("reports not configured when FORGE_SELF_REPO is unset", async () => {
    delete process.env.FORGE_SELF_REPO;
    const { getForgeStatus } = await import("@/lib/self-update");
    const status = await getForgeStatus();
    expect(status.configured).toBe(false);
    expect(status.selfRepo).toBeNull();
  });

  it("parses FORGE_SELF_REPO when set", async () => {
    process.env.FORGE_SELF_REPO = "acme/forge";
    process.env.FORGE_SELF_BRANCH = "main";
    const { getForgeStatus } = await import("@/lib/self-update");
    const status = await getForgeStatus();
    expect(status.configured).toBe(true);
    expect(status.selfRepo).toBe("acme/forge");
    expect(status.selfBranch).toBe("main");
  });
});

describe("reconcileStaleForgeUpdates", () => {
  const ids: string[] = [];

  afterEach(() => {
    for (const id of ids) {
      db.delete(forgeUpdates).where(eq(forgeUpdates.id, id)).run();
    }
    ids.length = 0;
  });

  it("marks orphaned pending updates as failed", async () => {
    const id = randomUUID();
    ids.push(id);
    db.insert(forgeUpdates)
      .values({
        id,
        status: "pending",
        trigger: "manual",
        logs: "",
        startedAt: new Date(),
      })
      .run();

    const { reconcileStaleForgeUpdates } = await import("@/lib/self-update");
    const count = await reconcileStaleForgeUpdates();
    expect(count).toBeGreaterThanOrEqual(1);

    const row = db
      .select()
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, id))
      .get();
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toMatch(/updater container/i);
  });
});
