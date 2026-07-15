import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import {
  archiveAgentSession,
  endAgentSession,
  getSessionForBranch,
  listArchivedAgentSessions,
  listAgentSessions,
  recreateAgentSession,
} from "@/lib/agent-runner";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

describe("agent session archive + recreate", () => {
  const ids: string[] = [];
  let rootDir = "";
  let clonePath = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "forge-archive-"));
    clonePath = join(rootDir, "work");
    await runGit(rootDir, ["init", clonePath]);
    await runGit(clonePath, ["checkout", "-b", "main"]);
    await runGit(clonePath, ["config", "user.email", "test@example.com"]);
    await runGit(clonePath, ["config", "user.name", "Test"]);
    await writeFile(join(clonePath, "README"), "hi\n");
    await runGit(clonePath, ["add", "README"]);
    await runGit(clonePath, ["commit", "-m", "init"]);
    await runGit(clonePath, ["checkout", "-b", "feature/a"]);
    await runGit(clonePath, ["checkout", "main"]);

    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name: `Archive Test ${id.slice(0, 8)}`,
        githubRepo: "acme/archive-test",
        branch: "main",
        clonePath,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);
  });

  afterEach(async () => {
    for (const id of ids) {
      const sessions = db
        .select({ id: agentSessions.id })
        .from(agentSessions)
        .where(eq(agentSessions.projectId, id))
        .all();
      for (const session of sessions) {
        try {
          await endAgentSession(session.id);
        } catch {
          // ignore
        }
      }
      db.delete(agentSessions).where(eq(agentSessions.projectId, id)).run();
      db.delete(projects).where(eq(projects.id, id)).run();
    }
    ids.length = 0;
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
      rootDir = "";
      clonePath = "";
    }
  });

  it("archives a session and frees the branch for a new live session", async () => {
    const projectId = ids[0]!;
    const sessionId = randomUUID();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "feature/a",
        status: "completed",
        initialPrompt: "first run",
        source: "manual",
        logs: "",
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .run();

    await archiveAgentSession(sessionId);

    expect(getSessionForBranch(projectId, "feature/a")).toBeUndefined();
    const archived = listArchivedAgentSessions(projectId);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe(sessionId);
    expect(archived[0]?.archivedAt).toBeTruthy();
    expect(listAgentSessions(projectId)).toHaveLength(0);

    // New live session can occupy the same branch
    const nextId = randomUUID();
    db.insert(agentSessions)
      .values({
        id: nextId,
        projectId,
        branch: "feature/a",
        status: "idle",
        initialPrompt: "second run",
        source: "manual",
        logs: "",
        startedAt: new Date(),
      })
      .run();

    expect(getSessionForBranch(projectId, "feature/a")?.id).toBe(nextId);
    expect(listArchivedAgentSessions(projectId)).toHaveLength(1);
  });

  it("recreate archives the live session and starts a fresh session row", async () => {
    const projectId = ids[0]!;
    const sessionId = randomUUID();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "feature/a",
        status: "completed",
        initialPrompt: "old prompt",
        source: "manual",
        logs: "old logs",
        cursorSessionId: "cursor-old",
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .run();

    const result = await recreateAgentSession(
      projectId,
      "feature/a",
      "brand new prompt",
    );
    expect(result.archivedSessionId).toBe(sessionId);
    expect(result.sessionId).not.toBe(sessionId);

    const live = getSessionForBranch(projectId, "feature/a");
    expect(live?.id).toBe(result.sessionId);
    expect(live?.initialPrompt).toBe("brand new prompt");
    expect(live?.cursorSessionId).toBeNull();
    expect(live?.archivedAt).toBeNull();

    const archived = listArchivedAgentSessions(projectId);
    expect(archived.some((s) => s.id === sessionId)).toBe(true);
    expect(archived.find((s) => s.id === sessionId)?.logs).toContain("old logs");
  });
});
