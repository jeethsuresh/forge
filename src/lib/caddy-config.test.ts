import { describe, expect, it } from "vitest";
import {
  applyServerLogging,
  buildRouteObject,
  defaultRouteFormValues,
  defaultServerLoggingForServer,
  forgeAccessLoggerInclude,
  forgeLogConfigKey,
  listHttpServers,
  parseAllServerLogging,
  parseHttpRoutes,
  parseRoute,
  parseServerLogging,
  removeRouteFromConfig,
  routeToFormValues,
  upsertRouteInConfig,
  validateRouteForm,
  validateServerLogging,
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

const subrouteConfig = {
  apps: {
    http: {
      servers: {
        srv0: {
          listen: [":443"],
          routes: [
            {
              match: [{ host: ["example.com"] }],
              handle: [
                {
                  handler: "subroute",
                  routes: [
                    {
                      match: [{ path: ["/api/*"] }],
                      handle: [
                        {
                          handler: "reverse_proxy",
                          upstreams: [{ dial: "127.0.0.1:3000" }],
                        },
                      ],
                    },
                    {
                      handle: [
                        {
                          handler: "file_server",
                          root: "/srv/www",
                        },
                      ],
                    },
                  ],
                },
              ],
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

  it("expands subroute handlers into editable child routes", () => {
    const routes = parseHttpRoutes(subrouteConfig);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({
      serverName: "srv0",
      index: 0,
      hosts: ["example.com"],
      paths: ["/api/*"],
      ownHosts: [],
      ownPaths: ["/api/*"],
      handlerKind: "reverse_proxy",
      upstreamDial: "127.0.0.1:3000",
      subroute: {
        parentRouteIndex: 0,
        path: [0],
        inheritedHosts: ["example.com"],
        inheritedPaths: [],
      },
    });
    expect(routes[1]).toMatchObject({
      hosts: ["example.com"],
      paths: [],
      ownHosts: [],
      ownPaths: [],
      handlerKind: "file_server",
      fileRoot: "/srv/www",
      subroute: {
        parentRouteIndex: 0,
        path: [1],
      },
    });
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

describe("subroute round trip", () => {
  it("preserves subroute structure when editing a child route", () => {
    const routes = parseHttpRoutes(subrouteConfig);
    const form = routeToFormValues(routes[0]);
    expect(validateRouteForm(form, routes[0].subroute)).toBeNull();

    const next = upsertRouteInConfig(subrouteConfig, form, {
      serverName: routes[0].serverName,
      index: routes[0].index,
      subroute: routes[0].subroute,
    });

    const updated = parseHttpRoutes(next)[0];
    expect(updated).toMatchObject({
      hosts: ["example.com"],
      paths: ["/api/*"],
      upstreamDial: "127.0.0.1:3000",
    });
    expect(next.apps.http.servers.srv0.routes[0].handle[0].handler).toBe(
      "subroute",
    );
  });

  it("removes a child route from a subroute", () => {
    const routes = parseHttpRoutes(subrouteConfig);
    const next = removeRouteFromConfig(
      subrouteConfig,
      "srv0",
      0,
      routes[0].subroute,
    );
    const remaining = parseHttpRoutes(next);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      handlerKind: "file_server",
      fileRoot: "/srv/www",
    });
  });

  it("allows child routes with only inherited matchers", () => {
    const routes = parseHttpRoutes(subrouteConfig);
    expect(
      validateRouteForm(routeToFormValues(routes[1]), routes[1].subroute),
    ).toBeNull();
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

describe("server logging", () => {
  it("enables file logging with forge-managed logger names", () => {
    const values = {
      ...defaultServerLoggingForServer("srv0"),
      enabled: true,
      output: "file" as const,
      filePath: "/var/log/caddy/access.log",
      format: "json" as const,
    };
    const next = applyServerLogging(sampleConfig, "srv0", values);
    const forgeKey = forgeLogConfigKey("srv0");

    expect(next).toMatchObject({
      logging: {
        logs: {
          [forgeKey]: {
            include: [forgeAccessLoggerInclude("srv0")],
            writer: {
              output: "file",
              filename: "/var/log/caddy/access.log",
            },
            encoder: { format: "json" },
          },
        },
      },
      apps: {
        http: {
          servers: {
            srv0: {
              logs: {
                default_logger_name: forgeKey,
              },
            },
          },
        },
      },
    });
  });

  it("round-trips logging settings through parse and apply", () => {
    const values = {
      ...defaultServerLoggingForServer("srv0"),
      enabled: true,
      output: "stdout" as const,
      format: "console" as const,
    };
    const next = applyServerLogging(sampleConfig, "srv0", values);
    expect(parseServerLogging(next, "srv0")).toEqual(values);
    expect(parseAllServerLogging(next)).toEqual({ srv0: values });
  });

  it("removes forge-managed logging when disabled", () => {
    const enabled = applyServerLogging(sampleConfig, "srv0", {
      ...defaultServerLoggingForServer("srv0"),
      enabled: true,
      output: "file",
      filePath: "/var/log/caddy/access.log",
      format: "json",
    });
    const disabled = applyServerLogging(enabled, "srv0", {
      ...defaultServerLoggingForServer("srv0"),
      enabled: false,
      output: "file",
      filePath: "/var/log/caddy/access.log",
      format: "json",
    });

    expect(disabled.logging).toBeUndefined();
    expect(disabled.apps.http.servers.srv0.logs).toBeUndefined();
    expect(parseServerLogging(disabled, "srv0").enabled).toBe(false);
  });

  it("validates file output requires a path", () => {
    expect(
      validateServerLogging({
        enabled: true,
        output: "file",
        filePath: "",
        format: "json",
      }),
    ).toMatch(/path/i);
    expect(
      validateServerLogging({
        enabled: true,
        output: "forge",
        filePath: "",
        format: "json",
      }),
    ).toBeNull();
  });

  it("defaults new server logging to push to forge", () => {
    expect(defaultServerLoggingForServer("srv0").output).toBe("forge");
  });

  it("configures forge push output with a TCP net writer", () => {
    const values = {
      ...defaultServerLoggingForServer("srv0"),
      enabled: true,
      output: "forge" as const,
      format: "json" as const,
    };
    const next = applyServerLogging(sampleConfig, "srv0", values);
    const forgeKey = forgeLogConfigKey("srv0");

    expect(next.logging?.logs?.[forgeKey]).toMatchObject({
      writer: { output: "net", address: "127.0.0.1:3999" },
      encoder: { format: "json" },
    });
    expect(parseServerLogging(next, "srv0").output).toBe("forge");
  });
});
