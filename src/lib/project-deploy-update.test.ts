import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployments, projects } from "@/lib/db/schema";
import {
  computeProjectDeployUpdate,
  deployedCommitShaForProjectBranch,
  getSuccessfulDeployCommitForBranch,
} from "@/lib/project-deploy-update";

describe("getSuccessfulDeployCommitForBranch", () => {
  const projectId = randomUUID();
  const deploymentIds: string[] = [];

  beforeEach(() => {
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Deploy Update Test",
        githubRepo: "acme/example",
        branch: "main",
        clonePath: `/tmp/${projectId}`,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  afterEach(() => {
    for (const id of deploymentIds) {
      db.delete(deployments).where(eq(deployments.id, id)).run();
    }
    deploymentIds.length = 0;
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  function insertDeployment(values: {
    branch: string;
    commitSha: string;
    status: "success" | "failed";
    completedAt: Date;
  }): string {
    const id = randomUUID();
    deploymentIds.push(id);
    db.insert(deployments)
      .values({
        id,
        projectId,
        branch: values.branch,
        commitSha: values.commitSha,
        status: values.status,
        trigger: "manual",
        logs: "",
        startedAt: values.completedAt,
        completedAt: values.completedAt,
      })
      .run();
    return id;
  }

  it("returns the latest successful commit for the branch", () => {
    insertDeployment({
      branch: "main",
      commitSha: "aaa111",
      status: "success",
      completedAt: new Date("2026-01-01T00:00:00Z"),
    });
    insertDeployment({
      branch: "main",
      commitSha: "bbb222",
      status: "success",
      completedAt: new Date("2026-01-02T00:00:00Z"),
    });
    insertDeployment({
      branch: "feature",
      commitSha: "ccc333",
      status: "success",
      completedAt: new Date("2026-01-03T00:00:00Z"),
    });

    expect(getSuccessfulDeployCommitForBranch(projectId, "main")).toBe("bbb222");
    expect(getSuccessfulDeployCommitForBranch(projectId, "feature")).toBe("ccc333");
  });

  it("ignores failed deployments", () => {
    insertDeployment({
      branch: "main",
      commitSha: "aaa111",
      status: "success",
      completedAt: new Date("2026-01-01T00:00:00Z"),
    });
    insertDeployment({
      branch: "main",
      commitSha: "failed999",
      status: "failed",
      completedAt: new Date("2026-01-02T00:00:00Z"),
    });

    expect(getSuccessfulDeployCommitForBranch(projectId, "main")).toBe("aaa111");
  });
});

describe("computeProjectDeployUpdate", () => {
  it("reports update available when branch tip differs from deployed commit", () => {
    expect(
      computeProjectDeployUpdate({
        branch: "main",
        watchBranch: "main",
        isForge: false,
        deployedCommitSha: "abc123",
        remoteCommitSha: "def456",
        remoteCommitLookupFailed: false,
      }),
    ).toMatchObject({
      updateAvailable: true,
      reason: "new_commit",
    });
  });

  it("uses forge branch rules for non-watch redeploys", () => {
    expect(
      computeProjectDeployUpdate({
        branch: "feature",
        watchBranch: "main",
        isForge: true,
        deployedCommitSha: "abc123",
        remoteCommitSha: "abc123",
        remoteCommitLookupFailed: false,
      }),
    ).toMatchObject({
      updateAvailable: true,
      reason: "new_commit",
    });
  });
});

describe("deployedCommitShaForProjectBranch", () => {
  let previousCommitSha: string | undefined;

  beforeEach(() => {
    previousCommitSha = process.env.FORGE_COMMIT_SHA;
    delete process.env.FORGE_COMMIT_SHA;
  });

  afterEach(() => {
    if (previousCommitSha === undefined) delete process.env.FORGE_COMMIT_SHA;
    else process.env.FORGE_COMMIT_SHA = previousCommitSha;
  });

  it("reads stable commit for forge projects", () => {
    const project = {
      id: randomUUID(),
      branch: "main",
    } as typeof projects.$inferSelect;

    expect(
      deployedCommitShaForProjectBranch(project, "main", true, {
        stableImageTag: "stable",
        rollbackImageTag: "rollback",
        stableCommitSha: "stable123",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("stable123");
  });

  it("prefers FORGE_COMMIT_SHA env for forge projects", () => {
    process.env.FORGE_COMMIT_SHA = "envsha777";
    const project = {
      id: randomUUID(),
      branch: "main",
    } as typeof projects.$inferSelect;

    expect(
      deployedCommitShaForProjectBranch(project, "main", true, {
        stableImageTag: "stable",
        rollbackImageTag: "rollback",
        stableCommitSha: "stable123",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("envsha777");
  });
});
