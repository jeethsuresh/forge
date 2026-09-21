import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, branchWorkspaces, projects } from "@/lib/db/schema";
import {
  endAgentAndDestroyBranchWorkspace,
  getSessionForBranch,
  listLiveBranches,
} from "@/lib/agent-runner";
import {
  getBranchWorkspace,
  setBranchWorkspaceDockerRunner,
} from "@/lib/branch-workspace";
import {
  isAgentSessionActive,
  isAgentSessionActiveOnBranch,
  markAgentSessionIdle,
  markAgentSessionLive,
} from "@/lib/agent-state";

describe("parallel agents and live branches", () => {
  const projectId = randomUUID();
  const sessionA = randomUUID();
  const sessionB = randomUUID();

  afterEach(() => {
    setBranchWorkspaceDockerRunner(null);
    markAgentSessionIdle(sessionA, projectId);
    markAgentSessionIdle(sessionB, projectId);
    db.delete(agentSessions).where(eq(agentSessions.projectId, projectId)).run();
    db.delete(branchWorkspaces).where(eq(branchWorkspaces.projectId, projectId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("treats two running sessions on different branches as both live", () => {
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "parallel",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/parallel",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values([
        {
          id: sessionA,
          projectId,
          branch: "agent/a",
          status: "running",
          initialPrompt: "a",
          logs: "",
          startedAt: now,
        },
        {
          id: sessionB,
          projectId,
          branch: "agent/b",
          status: "running",
          initialPrompt: "b",
          logs: "",
          startedAt: now,
        },
      ])
      .run();
    db.insert(branchWorkspaces)
      .values({
        id: randomUUID(),
        projectId,
        branch: "agent/a",
        workspacePath: "/tmp/ws-a",
        containerName: "forge-branch-a",
        status: "paused",
        createdAt: now,
      })
      .run();

    markAgentSessionLive(sessionA, projectId);
    markAgentSessionLive(sessionB, projectId);

    expect(isAgentSessionActive(projectId)).toBe(true);
    expect(isAgentSessionActiveOnBranch(projectId, "agent/a")).toBe(true);
    expect(isAgentSessionActiveOnBranch(projectId, "agent/b")).toBe(true);
    expect(isAgentSessionActiveOnBranch(projectId, "main")).toBe(false);

    const live = listLiveBranches(projectId);
    expect(live.map((b) => b.name).sort()).toEqual(["agent/a", "agent/b"]);
    expect(live.find((b) => b.name === "agent/a")?.containerStatus).toBe("paused");
    expect(live.find((b) => b.name === "agent/b")?.sessionId).toBe(sessionB);
  });

  it("merge of branch A ends A's agent and workspace only", async () => {
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "merge-live",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/merge-live",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(agentSessions)
      .values([
        {
          id: sessionA,
          projectId,
          branch: "agent/a",
          status: "running",
          initialPrompt: "a",
          logs: "",
          startedAt: now,
        },
        {
          id: sessionB,
          projectId,
          branch: "agent/b",
          status: "running",
          initialPrompt: "b",
          logs: "",
          startedAt: now,
        },
      ])
      .run();
    db.insert(branchWorkspaces)
      .values([
        {
          id: randomUUID(),
          projectId,
          branch: "agent/a",
          workspacePath: "/tmp/ws-a-gone",
          containerName: "forge-branch-a",
          status: "paused",
          createdAt: now,
        },
        {
          id: randomUUID(),
          projectId,
          branch: "agent/b",
          workspacePath: "/tmp/ws-b-keep",
          containerName: "forge-branch-b",
          status: "running",
          createdAt: now,
        },
      ])
      .run();

    setBranchWorkspaceDockerRunner(async () => ({ stdout: "", stderr: "" }));
    markAgentSessionLive(sessionA, projectId);
    markAgentSessionLive(sessionB, projectId);

    await endAgentAndDestroyBranchWorkspace(projectId, "agent/a", "branch_merged");

    expect(getSessionForBranch(projectId, "agent/a")).toBeUndefined();
    const ended = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionA))
      .get();
    expect(ended?.archivedAt).toBeTruthy();
    expect(ended?.status).toBe("failed");
    expect(ended?.errorMessage).toContain("branch_merged");
    expect(getBranchWorkspace(projectId, "agent/a")).toBeUndefined();

    const remaining = getSessionForBranch(projectId, "agent/b");
    expect(remaining?.status).toBe("running");
    expect(remaining?.archivedAt).toBeNull();
    expect(getBranchWorkspace(projectId, "agent/b")?.status).toBe("running");
  });
});
