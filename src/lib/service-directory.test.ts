import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, serviceDirectory } from "@/lib/db/schema";
import {
  listServiceDirectory,
  markServiceObserved,
  removeStaleDeclaredServices,
  setServiceHealth,
  setServiceRouteStatus,
  upsertDeclaredService,
} from "@/lib/service-directory";

describe("service-directory", () => {
  let projectId: string;

  beforeEach(() => {
    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Service Dir Project",
        githubRepo: "owner/service-dir",
        branch: "main",
        clonePath: `/tmp/${projectId}`,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  afterEach(() => {
    db.delete(serviceDirectory)
      .where(eq(serviceDirectory.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("upserts declared services and lists them", () => {
    upsertDeclaredService({
      projectId,
      deployTarget: "web",
      portName: "http",
      port: 8080,
      public: true,
      subdomain: "demo",
    });
    upsertDeclaredService({
      projectId,
      deployTarget: "api",
      portName: "grpc",
      port: 9090,
      public: false,
      subdomain: null,
    });

    const rows = listServiceDirectory({ projectId });
    expect(rows).toHaveLength(2);

    const http = rows.find((r) => r.portName === "http");
    expect(http).toMatchObject({
      projectId,
      deployTarget: "web",
      portName: "http",
      port: 8080,
      public: true,
      subdomain: "demo",
      status: "unknown",
      routeStatus: "none",
    });

    // Update declared fields on re-upsert
    upsertDeclaredService({
      projectId,
      deployTarget: "web",
      portName: "http",
      port: 8081,
      public: true,
      subdomain: "demo-v2",
    });
    const updated = listServiceDirectory({ projectId }).find(
      (r) => r.portName === "http",
    );
    expect(updated?.port).toBe(8081);
    expect(updated?.subdomain).toBe("demo-v2");
  });

  it("removes stale declared services not in keepKeys", () => {
    upsertDeclaredService({
      projectId,
      deployTarget: "web",
      portName: "http",
      port: 8080,
      public: true,
      subdomain: "demo",
    });
    upsertDeclaredService({
      projectId,
      deployTarget: "web",
      portName: "metrics",
      port: 9091,
      public: false,
      subdomain: null,
    });
    upsertDeclaredService({
      projectId,
      deployTarget: "api",
      portName: "http",
      port: 8082,
      public: false,
      subdomain: null,
    });

    removeStaleDeclaredServices(projectId, [
      { deployTarget: "web", portName: "http" },
    ]);

    const rows = listServiceDirectory({ projectId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deployTarget: "web",
      portName: "http",
    });
  });

  it("marks observed, health, and route status", () => {
    upsertDeclaredService({
      projectId,
      deployTarget: "web",
      portName: "http",
      port: 8080,
      public: true,
      subdomain: "demo",
    });

    markServiceObserved({
      projectId,
      deployTarget: "web",
      portName: "http",
      boundPort: 8080,
      deploymentId: "dep-1",
      commitSha: "abc123",
      status: "up",
    });

    setServiceHealth({
      projectId,
      deployTarget: "web",
      portName: "http",
      status: "up",
      lastLatencyMs: 12,
      lastError: null,
    });

    setServiceRouteStatus({
      projectId,
      deployTarget: "web",
      portName: "http",
      routeStatus: "synced",
      routeError: null,
      url: "https://demo.example.com",
    });

    const row = listServiceDirectory({ projectId })[0];
    expect(row).toMatchObject({
      boundPort: 8080,
      deploymentId: "dep-1",
      commitSha: "abc123",
      status: "up",
      lastLatencyMs: 12,
      routeStatus: "synced",
      url: "https://demo.example.com",
    });
    expect(row.lastCheckedAt).toBeTruthy();
  });

  it("lists all projects when projectId omitted", () => {
    const otherId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: otherId,
        name: "Other",
        githubRepo: "owner/other",
        branch: "main",
        clonePath: `/tmp/${otherId}`,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    try {
      upsertDeclaredService({
        projectId,
        deployTarget: "web",
        portName: "http",
        port: 8080,
        public: true,
        subdomain: null,
      });
      upsertDeclaredService({
        projectId: otherId,
        deployTarget: "web",
        portName: "http",
        port: 8081,
        public: true,
        subdomain: null,
      });

      const all = listServiceDirectory();
      expect(
        all.filter((r) => r.projectId === projectId || r.projectId === otherId)
          .length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      db.delete(serviceDirectory)
        .where(eq(serviceDirectory.projectId, otherId))
        .run();
      db.delete(projects).where(eq(projects.id, otherId)).run();
    }
  });
});
