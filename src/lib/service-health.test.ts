import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployTargets, projects, serviceDirectory } from "@/lib/db/schema";
import {
  listServiceDirectory,
  setServiceRouteStatus,
  upsertDeclaredService,
} from "@/lib/service-directory";
import {
  probeServiceHealth,
  resolveServiceProbeTarget,
  runServiceHealthTick,
} from "@/lib/service-health";

describe("resolveServiceProbeTarget", () => {
  it("prefers public URL when present", () => {
    expect(
      resolveServiceProbeTarget({
        url: "https://demo.example/",
        boundPort: 8080,
        port: 8080,
        healthPath: "/healthz",
      }),
    ).toBe("https://demo.example/healthz");
  });

  it("falls back to loopback bound port", () => {
    expect(
      resolveServiceProbeTarget({
        url: null,
        boundPort: 3456,
        port: 8080,
        healthPath: "/ready",
      }),
    ).toBe("http://127.0.0.1:3456/ready");
  });
});

describe("service health probes", () => {
  let projectId: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    projectId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Health Project",
        githubRepo: "owner/health",
        branch: "main",
        clonePath: `/tmp/${projectId}`,
        enabled: true,
        deployEnvJson: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(deployTargets)
      .values({
        id: randomUUID(),
        projectId,
        name: "web",
        autoDeploy: true,
        subdomain: "demo",
        portsJson: JSON.stringify([
          {
            name: "http",
            port: 8080,
            public: true,
            health: { path: "/healthz", interval_seconds: 30 },
          },
        ]),
        scriptsJson: "{}",
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
    setServiceRouteStatus({
      projectId,
      deployTarget: "web",
      portName: "http",
      routeStatus: "synced",
      routeError: null,
      url: "https://demo.example",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    db.delete(serviceDirectory)
      .where(eq(serviceDirectory.projectId, projectId))
      .run();
    db.delete(deployTargets)
      .where(eq(deployTargets.projectId, projectId))
      .run();
    db.delete(projects).where(eq(projects.id, projectId)).run();
  });

  it("marks service up on healthy response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    const row = listServiceDirectory({ projectId })[0]!;
    await probeServiceHealth(row);

    const updated = listServiceDirectory({ projectId })[0]!;
    expect(updated.status).toBe("up");
    expect(updated.lastLatencyMs).toBeTypeOf("number");
    expect(updated.lastError).toBeNull();
    expect(updated.lastCheckedAt).toBeTruthy();
  });

  it("marks service down on failed response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch;

    await probeServiceHealth(listServiceDirectory({ projectId })[0]!);
    expect(listServiceDirectory({ projectId })[0]).toMatchObject({
      status: "down",
      lastError: expect.stringMatching(/503/),
    });
  });

  it("marks service down on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await probeServiceHealth(listServiceDirectory({ projectId })[0]!);
    expect(listServiceDirectory({ projectId })[0]).toMatchObject({
      status: "down",
      lastError: expect.stringMatching(/ECONNREFUSED/),
    });
  });

  it("runServiceHealthTick probes eligible rows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;

    await runServiceHealthTick();
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(listServiceDirectory({ projectId })[0]?.status).toBe("up");
  });
});
