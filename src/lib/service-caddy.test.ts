import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, serviceDirectory } from "@/lib/db/schema";
import { listServiceDirectory, upsertDeclaredService } from "@/lib/service-directory";
import {
  buildServicePublicHost,
  forgePublicDomain,
  syncDeployTargetCaddyRoutes,
} from "@/lib/service-caddy";

vi.mock("@/lib/caddy", () => ({
  getCaddyConfig: vi.fn(),
  loadCaddyConfig: vi.fn(),
}));

import { getCaddyConfig, loadCaddyConfig } from "@/lib/caddy";

const mockedGet = vi.mocked(getCaddyConfig);
const mockedLoad = vi.mocked(loadCaddyConfig);

describe("service-caddy helpers", () => {
  it("builds subdomain host from forge public domain", () => {
    const prev = process.env.FORGE_PUBLIC_DOMAIN;
    process.env.FORGE_PUBLIC_DOMAIN = "forge.example";
    try {
      expect(forgePublicDomain()).toBe("forge.example");
      expect(buildServicePublicHost("demo")).toBe("demo.forge.example");
    } finally {
      if (prev === undefined) delete process.env.FORGE_PUBLIC_DOMAIN;
      else process.env.FORGE_PUBLIC_DOMAIN = prev;
    }
  });
});

describe("syncDeployTargetCaddyRoutes", () => {
  let projectId: string;

  beforeEach(() => {
    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Caddy Services",
        githubRepo: "owner/caddy-svc",
        branch: "main",
        clonePath: `/tmp/${projectId}`,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

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

    mockedGet.mockReset();
    mockedLoad.mockReset();
    mockedGet.mockResolvedValue({
      apps: { http: { servers: { srv0: { listen: [":80"], routes: [] } } } },
    });
    mockedLoad.mockResolvedValue(undefined);

    process.env.FORGE_PUBLIC_DOMAIN = "forge.test";
  });

  afterEach(() => {
    db.delete(serviceDirectory)
      .where(eq(serviceDirectory.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
    delete process.env.FORGE_PUBLIC_DOMAIN;
  });

  it("syncs public+subdomain routes and leaves private ports as none", async () => {
    await syncDeployTargetCaddyRoutes(projectId, "web");

    const rows = listServiceDirectory({ projectId });
    expect(rows.find((r) => r.portName === "http")).toMatchObject({
      routeStatus: "synced",
      routeError: null,
      url: "https://demo.forge.test",
    });
    expect(rows.find((r) => r.portName === "metrics")).toMatchObject({
      routeStatus: "none",
      url: null,
    });
    expect(mockedLoad).toHaveBeenCalled();
  });

  it("records route error without claiming a live URL", async () => {
    mockedLoad.mockRejectedValue(new Error("caddy unavailable"));

    await syncDeployTargetCaddyRoutes(projectId, "web");

    const http = listServiceDirectory({ projectId }).find(
      (r) => r.portName === "http",
    );
    expect(http).toMatchObject({
      routeStatus: "error",
      routeError: expect.stringMatching(/caddy unavailable/i),
    });
    expect(http?.url).toBeFalsy();
  });
});
