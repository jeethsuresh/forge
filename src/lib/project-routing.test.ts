import { describe, expect, it, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  applyHostPortToRoute,
  defaultProjectCaddyRoute,
  parseProjectCaddyConfig,
  parseProjectCaddyJson,
  serializeProjectCaddy,
  serializeProjectCaddyConfig,
  syncProjectRouteInConfig,
} from "@/lib/project-routing-shared";
import {
  buildRouteToProjectsIndex,
  hostPortConflict,
  projectRoutingView,
  resolveProjectHostPort,
  setProjectRouteLink,
  validateHostPort,
} from "@/lib/project-routing";
import { parseHttpRoutes } from "@/lib/caddy-config";

describe("validateHostPort", () => {
  it("accepts valid ports and null", () => {
    expect(validateHostPort(null)).toBeNull();
    expect(validateHostPort(3456)).toBeNull();
  });

  it("rejects invalid ports", () => {
    expect(validateHostPort(80)).toMatch(/between/);
    expect(validateHostPort(70000)).toMatch(/between/);
  });
});

describe("resolveProjectHostPort", () => {
  it("prefers dedicated hostPort column", () => {
    expect(
      resolveProjectHostPort({
        hostPort: 3912,
        deployEnvJson: JSON.stringify([
          { key: "HOST_PORT", value: "3456", secret: false },
        ]),
      }),
    ).toBe(3912);
  });

  it("falls back to deploy env HOST_PORT", () => {
    expect(
      resolveProjectHostPort({
        hostPort: null,
        deployEnvJson: JSON.stringify([
          { key: "HOST_PORT", value: "3456", secret: false },
        ]),
      }),
    ).toBe(3456);
  });
});

describe("project caddy json", () => {
  it("round-trips legacy managed settings", () => {
    const settings = {
      enabled: true,
      routeKey: "srv0:0",
      route: defaultProjectCaddyRoute(3456),
    };
    const raw = serializeProjectCaddy(settings);
    expect(parseProjectCaddyJson(raw)).toEqual(settings);
    expect(parseProjectCaddyConfig(raw)).toEqual({
      managed: settings,
      linkedRouteKeys: [],
    });
  });

  it("round-trips managed route with linked keys", () => {
    const config = {
      managed: {
        enabled: true,
        routeKey: "srv0:1",
        route: defaultProjectCaddyRoute(3456),
      },
      linkedRouteKeys: ["srv0:2", "srv0:3"],
    };
    const raw = serializeProjectCaddyConfig(config);
    expect(parseProjectCaddyConfig(raw)).toEqual(config);
  });
});

describe("syncProjectRouteInConfig", () => {
  it("adds and removes a reverse proxy route", () => {
    const projectId = "abc-123";
    const settings = {
      enabled: true,
      routeKey: null,
      route: {
        ...defaultProjectCaddyRoute(3456),
        hosts: "app.test",
        paths: "/",
      },
    };

    const added = syncProjectRouteInConfig({}, projectId, settings, 3456);
    const routes = parseHttpRoutes(added.config);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.upstreamDial).toBe("127.0.0.1:3456");
    expect(added.settings?.routeKey).toBeTruthy();

    const removed = syncProjectRouteInConfig(
      added.config,
      projectId,
      added.settings ? { ...added.settings, enabled: false } : null,
      3456,
    );
    expect(parseHttpRoutes(removed.config)).toHaveLength(0);
    expect(removed.settings).toBeNull();
  });

  it("updates upstream when host port changes", () => {
    const route = applyHostPortToRoute(defaultProjectCaddyRoute(3000), 3456);
    expect(route.upstreamDial).toBe("127.0.0.1:3456");
  });
});

describe("projectRoutingView", () => {
  it("exposes resolved host port and linked routes", () => {
    const view = projectRoutingView({
      hostPort: 4001,
      caddyRouteJson: JSON.stringify({
        managed: null,
        linkedRouteKeys: ["srv0:4"],
      }),
      deployEnvJson: "[]",
    });
    expect(view.resolvedHostPort).toBe(4001);
    expect(view.linkedRouteKeys).toEqual(["srv0:4"]);
  });
});

describe("hostPortConflict", () => {
  it("returns null when no rows exist", () => {
    expect(hostPortConflict(3999)).toBeNull();
  });
});

describe("route project links", () => {
  const ids: string[] = [];

  afterEach(() => {
    for (const id of ids) {
      db.delete(projects).where(eq(projects.id, id)).run();
    }
    ids.length = 0;
  });

  function insertProject(name: string, caddyRouteJson: string | null): string {
    const id = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id,
        name,
        githubRepo: "acme/example",
        branch: "main",
        clonePath: `/tmp/${id}`,
        enabled: true,
        caddyRouteJson,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ids.push(id);
    return id;
  }

  it("builds a reverse index from linked and managed routes", () => {
    const alphaId = insertProject(
      "Alpha",
      JSON.stringify({
        managed: {
          enabled: true,
          routeKey: "srv0:1",
          route: defaultProjectCaddyRoute(3456),
        },
        linkedRouteKeys: ["srv0:2"],
      }),
    );
    const betaId = insertProject(
      "Beta",
      JSON.stringify({ managed: null, linkedRouteKeys: ["srv0:2"] }),
    );

    const index = buildRouteToProjectsIndex();
    expect(index.get("srv0:1")).toEqual([
      { id: alphaId, name: "Alpha", kind: "managed" },
    ]);
    expect(index.get("srv0:2")).toEqual([
      { id: alphaId, name: "Alpha", kind: "linked" },
      { id: betaId, name: "Beta", kind: "linked" },
    ]);
  });

  it("links and unlinks routes for a project", () => {
    const projectId = insertProject("Gamma", null);
    expect(setProjectRouteLink(projectId, "srv0:9", true)).toEqual(["srv0:9"]);
    expect(setProjectRouteLink(projectId, "srv0:9", false)).toEqual([]);
  });
});
