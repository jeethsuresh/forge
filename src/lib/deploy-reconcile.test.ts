import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { db } from "@/lib/db";
import { agentSessions, deployments, projects } from "@/lib/db/schema";
import { saveProjectReleaseState } from "@/lib/deploy-rollback";
import {
  reconcileAbandonedDeployingSessions,
  reconcileInterruptedDeployments,
} from "@/lib/deploy-reconcile";

describe("reconcileInterruptedDeployments", () => {
  let tempDir: string;
  let previousReleaseState: string | undefined;
  let projectId: string;
  let deploymentId: string;
  let sessionId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "forge-deploy-reconcile-"));
    previousReleaseState = process.env.FORGE_RELEASE_STATE;
    process.env.FORGE_RELEASE_STATE = join(tempDir, "forge-release.json");

    projectId = randomUUID();
    deploymentId = randomUUID();
    sessionId = randomUUID();
    const now = new Date();

    db.insert(projects)
      .values({
        id: projectId,
        name: "Forge",
        githubRepo: "acme/forge",
        branch: "main",
        clonePath: "/tmp/forge",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(deployments)
      .values({
        id: deploymentId,
        projectId,
        commitSha: "abc1234567890",
        branch: "main",
        status: "staging",
        trigger: "agent",
        logs: "",
        startedAt: new Date(now.getTime() - 60_000),
      })
      .run();

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "deploying",
        initialPrompt: "test",
        logs: "",
        deploymentId,
        startedAt: now,
      })
      .run();
  });

  afterEach(() => {
    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(deployments).where(eq(deployments.id, deploymentId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    rmSync(tempDir, { recursive: true, force: true });
    if (previousReleaseState === undefined) {
      delete process.env.FORGE_RELEASE_STATE;
    } else {
      process.env.FORGE_RELEASE_STATE = previousReleaseState;
    }
    delete process.env.FORGE_SELF_REPO;
    delete process.env.FORGE_SOURCE_DIR;
  });

  it("marks interrupted forge deploys successful when release state matches", () => {
    process.env.FORGE_SELF_REPO = "acme/forge";
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()!;
    saveProjectReleaseState(projectId, "abc1234567890", project);

    const count = reconcileInterruptedDeployments(projectId);
    expect(count).toBe(1);

    const deployment = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .get();
    expect(deployment?.status).toBe("success");
    expect(deployment?.completedAt).not.toBeNull();

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("completed");
    delete process.env.FORGE_SELF_REPO;
  });

  it("reconciles forge deploys via clone path when FORGE_SELF_REPO is unset", () => {
    delete process.env.FORGE_SELF_REPO;
    const sourceDir = join(tempDir, "forge-source");
    process.env.FORGE_SOURCE_DIR = sourceDir;
    db.update(projects)
      .set({ clonePath: sourceDir })
      .where(eq(projects.id, projectId))
      .run();

    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()!;
    saveProjectReleaseState(projectId, "abc1234567890", project);

    const count = reconcileInterruptedDeployments(projectId);
    expect(count).toBe(1);

    const deployment = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .get();
    expect(deployment?.status).toBe("success");
  });

  it("leaves deploys alone when release state does not match", () => {
    writeFileSync(
      process.env.FORGE_RELEASE_STATE!,
      JSON.stringify({
        stableImageTag: "stable",
        rollbackImageTag: "rollback",
        stableCommitSha: "other999",
        updatedAt: new Date().toISOString(),
      }),
    );

    const count = reconcileInterruptedDeployments(projectId);
    expect(count).toBe(0);

    const deployment = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .get();
    expect(deployment?.status).toBe("staging");
  });
});

describe("reconcileAbandonedDeployingSessions", () => {
  let tempDir: string;
  let previousReleaseState: string | undefined;
  let projectId: string;
  let deploymentId: string;
  let sessionId: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "forge-deploy-abandon-"));
    previousReleaseState = process.env.FORGE_RELEASE_STATE;
    process.env.FORGE_RELEASE_STATE = join(tempDir, "forge-release.json");

    projectId = randomUUID();
    deploymentId = randomUUID();
    sessionId = randomUUID();
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);

    db.insert(projects)
      .values({
        id: projectId,
        name: "Forge",
        githubRepo: "acme/forge",
        branch: "main",
        clonePath: "/tmp/forge",
        enabled: true,
        createdAt: startedAt,
        updatedAt: startedAt,
      })
      .run();

    db.insert(deployments)
      .values({
        id: deploymentId,
        projectId,
        commitSha: "abc1234567890",
        branch: "main",
        status: "staging",
        trigger: "agent",
        logs: "",
        startedAt,
      })
      .run();

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "deploying",
        initialPrompt: "test",
        logs: "",
        deploymentId,
        startedAt,
      })
      .run();
  });

  afterEach(() => {
    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(deployments).where(eq(deployments.id, deploymentId)).run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    rmSync(tempDir, { recursive: true, force: true });
    if (previousReleaseState === undefined) {
      delete process.env.FORGE_RELEASE_STATE;
    } else {
      process.env.FORGE_RELEASE_STATE = previousReleaseState;
    }
  });

  it("fails stale deploying sessions when release moved on", () => {
    process.env.FORGE_SELF_REPO = "acme/forge";
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()!;
    saveProjectReleaseState(projectId, "bbbbbbbbbbbb", project);

    const count = reconcileAbandonedDeployingSessions(projectId);
    expect(count).toBe(1);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session?.status).toBe("failed");
    expect(session?.errorMessage).toMatch(/superseded/i);

    const deployment = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .get();
    expect(deployment?.status).toBe("failed");
    delete process.env.FORGE_SELF_REPO;
  });
});
