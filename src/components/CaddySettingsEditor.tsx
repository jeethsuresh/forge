"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type {
  HttpServerSummary,
  ParsedRoute,
  RouteFormValues,
  ServerLoggingFormValues,
} from "@/lib/caddy-config";
import {
  applyAllServerLogging,
  defaultRouteFormValues,
  defaultServerLoggingForServer,
  parseAllServerLogging,
  removeRouteFromConfig,
  routeToFormValues,
  upsertRouteInConfig,
  validateRouteForm,
  validateServerLogging,
} from "@/lib/caddy-config";

interface CaddyConfigResponse {
  adminUrl: string;
  config: Record<string, unknown>;
  servers: HttpServerSummary[];
  routes: ParsedRoute[];
}

type EditorMode = "list" | "create" | "edit";

function handlerLabel(kind: ParsedRoute["handlerKind"]): string {
  switch (kind) {
    case "reverse_proxy":
      return "Reverse proxy";
    case "file_server":
      return "File server";
    case "respond":
      return "Static response";
    case "unknown":
      return "Other";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function routeSummary(route: ParsedRoute): string {
  switch (route.handlerKind) {
    case "reverse_proxy":
      return route.upstreamDial ?? "—";
    case "file_server":
      return route.fileRoot ?? "—";
    case "respond":
      return route.respondBody ?? "—";
    case "unknown":
      return "Unsupported handler";
    default: {
      const _exhaustive: never = route.handlerKind;
      return _exhaustive;
    }
  }
}

function RouteForm({
  values,
  servers,
  inheritedHosts = [],
  inheritedPaths = [],
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  loading,
}: {
  values: RouteFormValues;
  servers: HttpServerSummary[];
  inheritedHosts?: string[];
  inheritedPaths?: string[];
  onChange: (values: RouteFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  loading: boolean;
}) {
  const serverOptions =
    servers.length > 0
      ? servers.map((server) => server.name)
      : [values.serverName || "srv0"];

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5"
    >
      {(inheritedHosts.length > 0 || inheritedPaths.length > 0) && (
        <div className="rounded-lg border border-zinc-700/80 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
          Inherited from parent subroute:{" "}
          {inheritedHosts.length > 0 && (
            <span className="text-zinc-400">
              hosts {inheritedHosts.join(", ")}
            </span>
          )}
          {inheritedHosts.length > 0 && inheritedPaths.length > 0 && " · "}
          {inheritedPaths.length > 0 && (
            <span className="text-zinc-400">
              paths {inheritedPaths.join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            HTTP server
          </span>
          <input
            list="caddy-server-names"
            value={values.serverName}
            onChange={(e) =>
              onChange({ ...values, serverName: e.target.value })
            }
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
            required
          />
          <datalist id="caddy-server-names">
            {serverOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            Hosts
          </span>
          <input
            type="text"
            value={values.hosts}
            onChange={(e) => onChange({ ...values, hosts: e.target.value })}
            placeholder="app.example.com, www.example.com"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            Paths
          </span>
          <input
            type="text"
            value={values.paths}
            onChange={(e) => onChange({ ...values, paths: e.target.value })}
            placeholder="/api/*, /static/*"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
          />
          <span className="mt-1 block text-xs text-zinc-600">
            Comma-separated matchers. Provide at least one host or path.
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium text-zinc-400">
            Handler
          </span>
          <select
            value={values.handlerKind}
            onChange={(e) =>
              onChange({
                ...values,
                handlerKind: e.target.value as RouteFormValues["handlerKind"],
              })
            }
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-orange-500/50"
          >
            <option value="reverse_proxy">Reverse proxy</option>
            <option value="file_server">File server</option>
            <option value="respond">Static response</option>
          </select>
        </label>

        {values.handlerKind === "reverse_proxy" && (
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Upstream dial
            </span>
            <input
              type="text"
              value={values.upstreamDial}
              onChange={(e) =>
                onChange({ ...values, upstreamDial: e.target.value })
              }
              placeholder="127.0.0.1:8080"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
              required
            />
          </label>
        )}

        {values.handlerKind === "file_server" && (
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Root directory
            </span>
            <input
              type="text"
              value={values.fileRoot}
              onChange={(e) => onChange({ ...values, fileRoot: e.target.value })}
              placeholder="/var/www"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
              required
            />
          </label>
        )}

        {values.handlerKind === "respond" && (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-400">
                Status code
              </span>
              <input
                type="number"
                min={100}
                max={599}
                value={values.respondStatus}
                onChange={(e) =>
                  onChange({ ...values, respondStatus: e.target.value })
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-zinc-400">
                Response body
              </span>
              <textarea
                value={values.respondBody}
                onChange={(e) =>
                  onChange({ ...values, respondBody: e.target.value })
                }
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
                required
              />
            </label>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ServerLoggingForm({
  serverName,
  values,
  onChange,
}: {
  serverName: string;
  values: ServerLoggingFormValues;
  onChange: (values: ServerLoggingFormValues) => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-200">{serverName}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            HTTP access logging for this server
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(e) =>
              onChange({ ...values, enabled: e.target.checked })
            }
            className="rounded border-zinc-600 bg-zinc-950 text-orange-500 focus:ring-orange-500/40"
          />
          Enable access logs
        </label>
      </div>

      {values.enabled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Output
            </span>
            <select
              value={values.output}
              onChange={(e) =>
                onChange({
                  ...values,
                  output: e.target.value as ServerLoggingFormValues["output"],
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-orange-500/50"
            >
              <option value="forge">Push to Forge</option>
              <option value="file">File</option>
              <option value="stdout">Standard output</option>
              <option value="stderr">Standard error</option>
            </select>
          </label>

          {values.output !== "forge" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Format
            </span>
            <select
              value={values.format}
              onChange={(e) =>
                onChange({
                  ...values,
                  format: e.target.value as ServerLoggingFormValues["format"],
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-orange-500/50"
            >
              <option value="json">JSON</option>
              <option value="console">Console</option>
            </select>
          </label>
          )}

          {values.output === "forge" && (
            <p className="sm:col-span-2 text-xs leading-relaxed text-zinc-500">
              Caddy streams JSON access logs to Forge over TCP on{" "}
              <code className="text-zinc-400">127.0.0.1:3999</code> (configurable
              via{" "}
              <code className="text-zinc-400">FORGE_CADDY_LOG_TCP_PORT</code>).
              External shippers can also POST JSON to{" "}
              <code className="text-zinc-400">/api/caddy/logs/ingest</code>.
            </p>
          )}

          {values.output === "file" && (
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-zinc-400">
                Log file path
              </span>
              <input
                type="text"
                value={values.filePath}
                onChange={(e) =>
                  onChange({ ...values, filePath: e.target.value })
                }
                placeholder="/var/log/caddy/access.log"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50"
                required
              />
              <span className="mt-1 block text-xs text-zinc-600">
                Set{" "}
                <code className="text-zinc-500">FORGE_CADDY_ACCESS_LOG_PATH</code>{" "}
                to this path so Forge can tail the same file in Access logs.
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export function CaddySettingsEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [adminUrl, setAdminUrl] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [servers, setServers] = useState<HttpServerSummary[]>([]);
  const [routes, setRoutes] = useState<ParsedRoute[]>([]);
  const [mode, setMode] = useState<EditorMode>("list");
  const [formValues, setFormValues] = useState<RouteFormValues>(
    defaultRouteFormValues("srv0"),
  );
  const [editingRoute, setEditingRoute] = useState<ParsedRoute | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [loggingByServer, setLoggingByServer] = useState<
    Record<string, ServerLoggingFormValues>
  >({});

  const defaultServerName = useMemo(
    () => servers[0]?.name ?? "srv0",
    [servers],
  );

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/caddy/config");
      const data = (await res.json()) as CaddyConfigResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load Caddy config");
        return;
      }
      setAdminUrl(data.adminUrl);
      setConfig(data.config);
      setServers(data.servers);
      setRoutes(data.routes);
      setLoggingByServer(parseAllServerLogging(data.config));
      setRawJson(JSON.stringify(data.config, null, 2));
    } catch {
      setError("Network error while loading Caddy config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchConfig();
    });
  }, [fetchConfig]);

  async function applyConfig(nextConfig: Record<string, unknown>) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/caddy/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig }),
      });
      const data = (await res.json()) as { error?: string; details?: string };
      if (!res.ok) {
        setError(
          data.details
            ? `${data.error ?? "Failed to apply config"}: ${data.details}`
            : (data.error ?? "Failed to apply config"),
        );
        return;
      }
      setSuccess("Caddy config validated and applied.");
      await fetchConfig();
      setMode("list");
      setEditingRoute(null);
    } catch {
      setError("Network error while applying Caddy config");
    } finally {
      setSaving(false);
    }
  }

  function startCreate() {
    setFormValues(defaultRouteFormValues(defaultServerName));
    setEditingRoute(null);
    setMode("create");
    setError("");
    setSuccess("");
  }

  function startEdit(route: ParsedRoute) {
    setFormValues(routeToFormValues(route));
    setEditingRoute(route);
    setMode("edit");
    setError("");
    setSuccess("");
  }

  async function saveRoute() {
    const validationError = validateRouteForm(
      formValues,
      editingRoute?.subroute,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    const next = upsertRouteInConfig(
      config,
      formValues,
      editingRoute
        ? {
            serverName: editingRoute.serverName,
            index: editingRoute.index,
            subroute: editingRoute.subroute,
          }
        : undefined,
    );
    setConfig(next);
    setRawJson(JSON.stringify(next, null, 2));
    await applyConfig(next);
  }

  async function deleteRoute(route: ParsedRoute) {
    const next = removeRouteFromConfig(
      config,
      route.serverName,
      route.index,
      route.subroute,
    );
    setConfig(next);
    setRawJson(JSON.stringify(next, null, 2));
    await applyConfig(next);
  }

  function updateServerLogging(
    serverName: string,
    values: ServerLoggingFormValues,
  ) {
    setLoggingByServer((current) => ({
      ...current,
      [serverName]: values,
    }));
  }

  async function saveLogging() {
    for (const [serverName, values] of Object.entries(loggingByServer)) {
      const validationError = validateServerLogging(values);
      if (validationError) {
        setError(`${serverName}: ${validationError}`);
        return;
      }
    }

    const next = applyAllServerLogging(config, loggingByServer);
    setConfig(next);
    setRawJson(JSON.stringify(next, null, 2));
    await applyConfig(next);
  }

  async function applyRawJson() {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      await applyConfig(parsed);
    } catch {
      setError("Raw JSON is invalid");
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl bg-zinc-800/60"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-zinc-400">Caddy admin API</p>
          <p className="font-mono text-sm text-zinc-200">{adminUrl}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void fetchConfig()}
            disabled={saving}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowRawJson((value) => !value)}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            {showRawJson ? "Hide JSON" : "Edit JSON"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-400">
          {success}
        </div>
      )}

      {showRawJson && (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">Full config JSON</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Loaded from <code className="text-zinc-400">GET /config/</code> and
              applied with <code className="text-zinc-400">POST /load</code>.
            </p>
          </div>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-orange-500/50"
          />
          <button
            type="button"
            onClick={() => void applyRawJson()}
            disabled={saving}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
          >
            Validate &amp; apply JSON
          </button>
        </div>
      )}

      {mode === "list" ? (
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-zinc-200">
                  Access logging
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Enable JSON access logs per HTTP server and write them to a
                  file Forge can tail.
                </p>
              </div>
              {servers.length > 0 && (
                <button
                  type="button"
                  onClick={() => void saveLogging()}
                  disabled={saving}
                  className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                >
                  {saving ? "Applying…" : "Save logging"}
                </button>
              )}
            </div>

            {servers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-6 py-8 text-center">
                <p className="text-sm text-zinc-500">
                  Add an HTTP route to create a server before configuring
                  logging.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {servers.map((server) => (
                  <ServerLoggingForm
                    key={server.name}
                    serverName={server.name}
                    values={
                      loggingByServer[server.name] ??
                      defaultServerLoggingForServer(server.name)
                    }
                    onChange={(values) =>
                      updateServerLogging(server.name, values)
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">HTTP routes</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Edit reverse proxy, file server, and static response routes.
              </p>
            </div>
            <button
              type="button"
              onClick={startCreate}
              disabled={saving}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
            >
              Add route
            </button>
          </div>

          {servers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {servers.map((server) => (
                <span
                  key={server.name}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400"
                >
                  {server.name} · {server.listen.join(", ") || "no listeners"} ·{" "}
                  {server.routeCount} route{server.routeCount === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          )}

          {routes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 px-6 py-10 text-center">
              <p className="text-sm text-zinc-500">
                No HTTP routes found in the running Caddy config.
              </p>
              <button
                type="button"
                onClick={startCreate}
                className="mt-4 text-sm font-medium text-orange-400 hover:text-orange-300"
              >
                Add your first route
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {routes.map((route) => (
                <li
                  key={route.key}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300">
                          {route.serverName}
                        </span>
                        <span className="rounded-md bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-300">
                          {handlerLabel(route.handlerKind)}
                        </span>
                        {route.subroute && (
                          <span className="rounded-md bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300">
                            Subroute
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-zinc-200">
                        {route.hosts.length > 0
                          ? route.hosts.join(", ")
                          : "Any host"}
                        {route.paths.length > 0 && (
                          <span className="text-zinc-500">
                            {" "}
                            · {route.paths.join(", ")}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-zinc-500">
                        {routeSummary(route)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(route)}
                        disabled={saving || route.handlerKind === "unknown"}
                        className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteRoute(route)}
                        disabled={saving}
                        className="rounded-lg border border-red-400/30 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">
            {mode === "create" ? "Add route" : "Edit route"}
          </h2>
          <RouteForm
            values={formValues}
            servers={servers}
            inheritedHosts={editingRoute?.subroute?.inheritedHosts}
            inheritedPaths={editingRoute?.subroute?.inheritedPaths}
            onChange={setFormValues}
            onSubmit={() => void saveRoute()}
            onCancel={() => {
              setMode("list");
              setEditingRoute(null);
            }}
            submitLabel={saving ? "Applying…" : "Save & apply"}
            loading={saving}
          />
        </div>
      )}
    </div>
  );
}
