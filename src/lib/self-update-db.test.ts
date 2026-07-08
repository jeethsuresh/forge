import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { describe, expect, it, afterEach } from "vitest";
import Database from "better-sqlite3";

const SCRIPT = join(process.cwd(), "scripts/lib/self-update-db.py");

function runPy(args: string[]): void {
  execFileSync("python3", [SCRIPT, ...args], { stdio: "pipe" });
}

function createDb(): { dir: string; path: string; updateId: string } {
  const dir = mkdtempSync(join(tmpdir(), "forge-self-update-db-"));
  const path = join(dir, "forge.db");
  const updateId = randomUUID();
  const db = new Database(path);
  db.exec(`
    CREATE TABLE forge_updates (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      target_commit_sha TEXT,
      previous_commit_sha TEXT,
      logs TEXT NOT NULL DEFAULT '',
      error_message TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO forge_updates (id, status, trigger, logs, started_at)
     VALUES (?, 'pending', 'manual', '', ?)`,
  ).run(updateId, Math.floor(Date.now() / 1000));
  db.close();
  return { dir, path, updateId };
}

describe("self-update-db.py", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends logs safely", () => {
    const { dir, path, updateId } = createDb();
    tempDirs.push(dir);
    runPy(["--db", path, "--update-id", updateId, "log", "line one"]);
    runPy([
      "--db",
      path,
      "--update-id",
      updateId,
      "log",
      "O'Brien said \"failed\"",
    ]);

    const db = new Database(path);
    const row = db
      .prepare("SELECT logs FROM forge_updates WHERE id = ?")
      .get(updateId) as { logs: string };
    db.close();

    expect(row.logs).toContain("line one");
    expect(row.logs).toContain("O'Brien said \"failed\"");
  });

  it("sets failed status with escaped error text", () => {
    const { dir, path, updateId } = createDb();
    tempDirs.push(dir);
    runPy([
      "--db",
      path,
      "--update-id",
      updateId,
      "status",
      "failed",
      "--error",
      "Staging health check failed; production was not changed",
      "--completed",
    ]);

    const db = new Database(path);
    const row = db
      .prepare(
        "SELECT status, error_message, completed_at FROM forge_updates WHERE id = ?",
      )
      .get(updateId) as {
      status: string;
      error_message: string;
      completed_at: number | null;
    };
    db.close();

    expect(row.status).toBe("failed");
    expect(row.error_message).toContain("production was not changed");
    expect(row.completed_at).not.toBeNull();
  });

  it("returns empty error when update row is missing", () => {
    const { dir, path } = createDb();
    tempDirs.push(dir);
    const output = execFileSync("python3", [
      SCRIPT,
      "--db",
      path,
      "--update-id",
      randomUUID(),
      "get-error",
    ]).toString("utf8");
    expect(output.trim()).toBe("");
  });

  it("records previous and target commits", () => {
    const { dir, path, updateId } = createDb();
    tempDirs.push(dir);
    runPy([
      "--db",
      path,
      "--update-id",
      updateId,
      "previous-commit",
      "abc123",
    ]);
    runPy([
      "--db",
      path,
      "--update-id",
      updateId,
      "status",
      "success",
      "--target-commit",
      "def456",
      "--completed",
    ]);

    const db = new Database(path);
    const row = db
      .prepare(
        "SELECT previous_commit_sha, target_commit_sha, status FROM forge_updates WHERE id = ?",
      )
      .get(updateId) as {
      previous_commit_sha: string;
      target_commit_sha: string;
      status: string;
    };
    db.close();

    expect(row.previous_commit_sha).toBe("abc123");
    expect(row.target_commit_sha).toBe("def456");
    expect(row.status).toBe("success");
  });
});
