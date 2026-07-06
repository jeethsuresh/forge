import { describe, expect, it } from "vitest";
import {
  buildRouteObject,
  defaultRouteFormValues,
  listHttpServers,
  parseHttpRoutes,
  parseRoute,
  removeRouteFromConfig,
  routeToFormValues,
  upsertRouteInConfig,
  validateRouteForm,
} from "@/lib/caddy-config";

const sampleConfig = {
  apps: {
    http: {
      servers: {
        srv0: {
          listen: [":443", ":80"],
          routes: [
            {
              match: [{ host: ["example.com"], path: ["/api/*"] }],
              handle: [
                {
                  handler: "reverse_proxy",
                  upstreams: [{ dial: "127.0.0.1:3000" }],
                },
              ],
            },
            {
              match: [{ host: ["static.example.com"] }],
              handle: [{ handler: "file_server", root: "/srv/www" }],
            },
          ],
        },
      },
    },
  },
};

describe("parseHttpRoutes", () => {
  it("extracts reverse proxy and file server routes", () => {
    const routes = parseHttpRoutes(sampleConfig);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({
      serverName: "srv0",
      index: 0,
      hosts: ["example.com"],
      paths: ["/api/*"],
      handlerKind: "reverse_proxy",
      upstreamDial: "127.0.0.1:3000",
    });
    expect(routes[1]).toMatchObject({
      handlerKind: "file_server",
      fileRoot: "/srv/www",
    });
  });

  it("returns an empty list when http servers are missing", () => {
    expect(parseHttpRoutes({})).toEqual([]);
  });
});

describe("listHttpServers", () => {
  it("summarizes server listeners and route counts", () => {
    expect(listHttpServers(sampleConfig)).toEqual([
      {
        name: "srv0",
        listen: [":443", ":80"],
        routeCount: 2,
      },
    ]);
  });
});

describe("buildRouteObject", () => {
  it("builds a reverse proxy route", () => {
    const route = buildRouteObject({
      ...defaultRouteFormValues("srv0"),
      hosts: "app.example.com",
      paths: "/",
      upstreamDial: "localhost:8080",
    });
    expect(route).toEqual({
      match: [{ host: ["app.example.com"], path: ["/"] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: "localhost:8080" }],
        },
      ],
    });
  });
});

describe("upsertRouteInConfig", () => {
  it("appends a new route to an existing server", () => {
    const values = {
      ...defaultRouteFormValues("srv0"),
      hosts: "new.example.com",
      upstreamDial: "127.0.0.1:4000",
    };
    const next = upsertRouteInConfig(sampleConfig, values);
    expect(parseHttpRoutes(next)).toHaveLength(3);
    expect(parseHttpRoutes(next)[2]).toMatchObject({
      hosts: ["new.example.com"],
      upstreamDial: "127.0.0.1:4000",
    });
  });

  it("updates an existing route in place", () => {
    const values = {
      ...defaultRouteFormValues("srv0"),
      hosts: "updated.example.com",
      upstreamDial: "127.0.0.1:9999",
    };
    const next = upsertRouteInConfig(sampleConfig, values, {
      serverName: "srv0",
      index: 0,
    });
    const routes = parseHttpRoutes(next);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({
      hosts: ["updated.example.com"],
      upstreamDial: "127.0.0.1:9999",
    });
  });

  it("creates a default server when config is empty", () => {
    const values = {
      ...defaultRouteFormValues("srv0"),
      hosts: "first.example.com",
      upstreamDial: "127.0.0.1:3000",
    };
    const next = upsertRouteInConfig({}, values);
    expect(listHttpServers(next)).toEqual([
      { name: "srv0", listen: [":80", ":443"], routeCount: 1 },
    ]);
  });
});

describe("removeRouteFromConfig", () => {
  it("removes a route by server and index", () => {
    const next = removeRouteFromConfig(sampleConfig, "srv0", 0);
    expect(parseHttpRoutes(next)).toHaveLength(1);
    expect(parseHttpRoutes(next)[0].hosts).toEqual(["static.example.com"]);
  });
});

describe("route round trip", () => {
  it("preserves editable fields through form conversion", () => {
    const parsed = parseRoute("srv0", 0, sampleConfig.apps.http.servers.srv0.routes[0]);
    const form = routeToFormValues(parsed);
    expect(validateRouteForm(form)).toBeNull();
    const rebuilt = buildRouteObject(form);
    expect(rebuilt).toEqual(sampleConfig.apps.http.servers.srv0.routes[0]);
  });
});
