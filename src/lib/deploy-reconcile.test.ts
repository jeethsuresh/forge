import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { db } from "@/lib/db";
import { agentSessions, deployments, projects } from "@/lib/db/schema";
import { saveProjectReleaseState } from "@/lib/deploy-rollback";
import { reconcileInterruptedDeployments } from "@/lib/deploy-reconcile";

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
