import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { forgeUpdates } from "@/lib/db/schema";

vi.mock("@/lib/github", () => ({
  parseGithubRepo: (repo: string) => repo,
  getRemoteCommitSha: vi.fn(),
  validateBranchName: (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return "Branch name is required";
    return null;
  },
  formatGitError: (err: unknown) =>
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: string }).message)
      : String(err),
}));

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>(
    "child_process",
  );
  return {
    ...actual,
    execFile: (
      file: string,
      args: string[],
      options: unknown,
      callback?: (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      const cb =
        typeof options === "function"
          ? (options as typeof callback)
          : callback;
      if (!cb) {
        throw new Error("execFile callback required in tests");
      }

      if (file === "docker" && args[0] === "ps") {
        cb(null, "", "");
        return;
      }
      if (file === "docker" && args[0] === "image") {
        cb(new Error("not found"), "", "");
        return;
      }
      if (file === "docker" && args[0] === "run") {
        cb(null, "container-id", "");
        return;
      }
      if (file === "docker" && args[0] === "info") {
        cb(null, "ok", "");
        return;
      }

      return actual.execFile(file, args, options as never, cb as never);
    },
  };
});

import { getRemoteCommitSha } from "@/lib/github";

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
    vi.mocked(getRemoteCommitSha).mockReset();
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
    vi.mocked(getRemoteCommitSha).mockResolvedValue("remote123");
    const { getForgeStatus } = await import("@/lib/self-update");
    const status = await getForgeStatus();
    expect(status.configured).toBe(true);
    expect(status.selfRepo).toBe("acme/forge");
    expect(status.selfBranch).toBe("main");
  });

  it("flags remote lookup failures without offering an update", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-status-"));
    const previousState = process.env.FORGE_RELEASE_STATE;
    process.env.FORGE_RELEASE_STATE = join(tempDir, "release.json");
    writeFileSync(
      process.env.FORGE_RELEASE_STATE,
      JSON.stringify({
        stableImageTag: "stable",
        rollbackImageTag: "rollback",
        stableCommitSha: "abc123",
        updatedAt: "2026-07-07T00:00:00Z",
      }),
    );
    process.env.FORGE_SELF_REPO = "acme/forge";
    vi.mocked(getRemoteCommitSha).mockRejectedValue(new Error("network down"));
    const { getForgeStatus } = await import("@/lib/self-update");
    const status = await getForgeStatus();
    expect(status.remoteCommitLookupFailed).toBe(true);
    expect(status.updateAvailable).toBe(false);

    if (previousState === undefined) delete process.env.FORGE_RELEASE_STATE;
    else process.env.FORGE_RELEASE_STATE = previousState;
    rmSync(tempDir, { recursive: true, force: true });
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

  it("preserves existing error messages when reconciling", async () => {
    const id = randomUUID();
    ids.push(id);
    db.insert(forgeUpdates)
      .values({
        id,
        status: "building",
        trigger: "manual",
        logs: "partial",
        errorMessage: "Build failed",
        startedAt: new Date(),
      })
      .run();

    const { reconcileStaleForgeUpdates } = await import("@/lib/self-update");
    await reconcileStaleForgeUpdates();

    const row = db
      .select()
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, id))
      .get();
    expect(row?.errorMessage).toBe("Build failed");
  });
});

describe("startForgeUpdate guards", () => {
  let previousRepo: string | undefined;
  let previousBranch: string | undefined;

  beforeEach(() => {
    previousRepo = process.env.FORGE_SELF_REPO;
    previousBranch = process.env.FORGE_SELF_BRANCH;
    process.env.FORGE_SELF_REPO = "acme/forge";
    process.env.FORGE_SELF_BRANCH = "main";
    vi.mocked(getRemoteCommitSha).mockResolvedValue("same123456789");
  });

  afterEach(() => {
    if (previousRepo === undefined) delete process.env.FORGE_SELF_REPO;
    else process.env.FORGE_SELF_REPO = previousRepo;
    if (previousBranch === undefined) delete process.env.FORGE_SELF_BRANCH;
    else process.env.FORGE_SELF_BRANCH = previousBranch;
  });

  it("allows a manual redeploy when already on the latest commit", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-release-"));
    const previousState = process.env.FORGE_RELEASE_STATE;
    process.env.FORGE_RELEASE_STATE = join(tempDir, "release.json");
    writeFileSync(
      process.env.FORGE_RELEASE_STATE,
      JSON.stringify({
        stableImageTag: "stable",
        rollbackImageTag: "rollback",
        stableCommitSha: "same123456789",
        updatedAt: "2026-07-07T00:00:00Z",
      }),
    );

    const beforeIds = new Set(
      db.select({ id: forgeUpdates.id }).from(forgeUpdates).all().map((r) => r.id),
    );

    const { startForgeUpdate } = await import("@/lib/self-update");
    // Same-SHA manual redeploy is allowed, so it proceeds past the "up to date"
    // guard and attempts to spawn the updater (which fails under the mock).
    await expect(startForgeUpdate()).rejects.not.toThrow(
      /Already running the latest commit/,
    );

    const newRows = db
      .select({ id: forgeUpdates.id })
      .from(forgeUpdates)
      .all()
      .filter((r) => !beforeIds.has(r.id));
    // The spawn attempt was recorded rather than rejected at the guard.
    expect(newRows.length).toBe(1);
    db.delete(forgeUpdates).where(eq(forgeUpdates.id, newRows[0].id)).run();

    if (previousState === undefined) delete process.env.FORGE_RELEASE_STATE;
    else process.env.FORGE_RELEASE_STATE = previousState;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects updates when GitHub is unreachable", async () => {
    vi.mocked(getRemoteCommitSha).mockRejectedValue(new Error("offline"));
    const { startForgeUpdate } = await import("@/lib/self-update");
    await expect(startForgeUpdate()).rejects.toThrow(/Could not reach GitHub/);
  });

  it("allows redeploy from a non-watch branch when its remote tip is reachable", async () => {
    vi.mocked(getRemoteCommitSha).mockImplementation(async (_repo, branch) => {
      if (branch === "feature/dev") return "feature123456789";
      return "same123456789";
    });

    const beforeIds = new Set(
      db.select({ id: forgeUpdates.id }).from(forgeUpdates).all().map((r) => r.id),
    );

    const { startForgeUpdate } = await import("@/lib/self-update");
    await expect(
      startForgeUpdate({ branch: "feature/dev" }),
    ).rejects.not.toThrow(/Could not reach GitHub/);

    const newRows = db
      .select()
      .from(forgeUpdates)
      .all()
      .filter((r) => !beforeIds.has(r.id));
    expect(newRows).toHaveLength(1);
    expect(newRows[0]?.logs).toContain("feature/dev");
    if (newRows[0]) {
      db.delete(forgeUpdates).where(eq(forgeUpdates.id, newRows[0].id)).run();
    }
  });

  it("rejects non-watch redeploy when the branch is missing on GitHub", async () => {
    vi.mocked(getRemoteCommitSha).mockImplementation(async (_repo, branch) => {
      if (branch === "missing") {
        throw new Error('Branch "missing" not found on acme/forge');
      }
      return "same123456789";
    });

    const { startForgeUpdate } = await import("@/lib/self-update");
    await expect(startForgeUpdate({ branch: "missing" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("isForgeUpdateInProgress", () => {
  const ids: string[] = [];

  afterEach(() => {
    for (const id of ids) {
      db.delete(forgeUpdates).where(eq(forgeUpdates.id, id)).run();
    }
    ids.length = 0;
  });

  it("reconciles stale in-progress rows before reporting idle", async () => {
    const id = randomUUID();
    ids.push(id);
    db.insert(forgeUpdates)
      .values({
        id,
        status: "testing",
        trigger: "manual",
        logs: "running",
        startedAt: new Date(),
      })
      .run();

    const { isForgeUpdateInProgress } = await import("@/lib/self-update");
    expect(await isForgeUpdateInProgress()).toBe(false);

    const row = db
      .select()
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, id))
      .get();
    expect(row?.status).toBe("failed");
  });
});
