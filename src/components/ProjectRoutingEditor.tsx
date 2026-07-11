"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HttpServerSummary, ParsedRoute } from "@/lib/caddy-config";
import {
  defaultProjectCaddyRoute,
  resolveRoutesByKeys,
  routeDisplayLabel,
} from "@/lib/project-routing-shared";
import type { ProjectCaddySettings } from "@/lib/project-routing-shared";
import { CaddyRouteForm } from "@/components/CaddyRouteForm";
import { ProjectCaddyRouteAssociation } from "@/components/ProjectCaddyRouteAssociation";

const CADDY_CONFIG_CACHE_MS = 30_000;
let cachedCaddyConfig:
  | { expiresAt: number; servers: HttpServerSummary[]; routes: ParsedRoute[] }
  | null = null;

export interface ProjectRoutingValues {
  hostPort: number | null;
  resolvedHostPort: number | null;
  composeProjectName: string;
  caddyRoute: ProjectCaddySettings | null;
  linkedRouteKeys?: string[];
}

interface ProjectRoutingEditorProps {
  projectId: string;
  values: ProjectRoutingValues;
  disabled?: boolean;
  saving?: boolean;
  compact?: boolean;
  onSave: (payload: {
    hostPort: number | null;
    caddyRoute: ProjectCaddySettings | null;
    linkedRouteKeys: string[];
  }) => Promise<boolean>;
}

function emptyCaddyRoute(hostPort: number | null): ProjectCaddySettings {
  return {
    enabled: false,
    routeKey: null,
    route: defaultProjectCaddyRoute(hostPort),
  };
}

function handlerSummary(route: ParsedRoute): string {
  switch (route.handlerKind) {
    case "reverse_proxy":
      return route.upstreamDial ?? "reverse proxy";
    case "file_server":
      return route.fileRoot ?? "file server";
    case "respond":
      return `respond ${route.respondStatus ?? 200}`;
    case "unknown":
      return "other handler";
    default: {
      const _exhaustive: never = route.handlerKind;
      return _exhaustive;
    }
  }
}

export function ProjectRoutingEditor({
  projectId,
  values,
  disabled = false,
  saving = false,
  compact = false,
  onSave,
}: ProjectRoutingEditorProps) {
  const [hostPortInput, setHostPortInput] = useState(
    values.hostPort !== null ? String(values.hostPort) : "",
  );
  const [caddyEnabled, setCaddyEnabled] = useState(
    values.caddyRoute?.enabled ?? false,
  );
  const [caddyRoute, setCaddyRoute] = useState(
    values.caddyRoute ?? emptyCaddyRoute(values.resolvedHostPort),
  );
  const [linkedRouteKeys, setLinkedRouteKeys] = useState(
    values.linkedRouteKeys ?? [],
  );
  const [servers, setServers] = useState<HttpServerSummary[]>([]);
  const [liveRoutes, setLiveRoutes] = useState<ParsedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const resolvedPort =
    hostPortInput.trim() === ""
      ? values.resolvedHostPort
      : Number.parseInt(hostPortInput.trim(), 10);

  const loadCaddyData = useCallback(() => {
    const now = Date.now();
    if (cachedCaddyConfig && cachedCaddyConfig.expiresAt > now) {
      setServers(cachedCaddyConfig.servers);
      setLiveRoutes(cachedCaddyConfig.routes);
      return;
    }

    fetch("/api/caddy/config")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load Caddy config");
        const data = (await res.json()) as {
          servers?: HttpServerSummary[];
          routes?: ParsedRoute[];
        };
        const servers = data.servers ?? [];
        const routes = data.routes ?? [];
        cachedCaddyConfig = {
          expiresAt: Date.now() + CADDY_CONFIG_CACHE_MS,
          servers,
          routes,
        };
        setServers(servers);
        setLiveRoutes(routes);
      })
      .catch(() => {
        setServers([]);
        setLiveRoutes([]);
      });
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      loadCaddyData();
    });
  }, [loadCaddyData]);

  const linkedRoutes = useMemo(
    () => resolveRoutesByKeys(linkedRouteKeys, liveRoutes),
    [linkedRouteKeys, liveRoutes],
  );

  const managedLiveRoute = useMemo(() => {
    if (!caddyRoute.routeKey) return null;
    return liveRoutes.find((route) => route.key === caddyRoute.routeKey) ?? null;
  }, [caddyRoute.routeKey, liveRoutes]);

  const associatedRoutes = useMemo(() => {
    const routes: ParsedRoute[] = [...linkedRoutes];
    if (managedLiveRoute) {
      routes.unshift(managedLiveRoute);
    }
    return routes;
  }, [linkedRoutes, managedLiveRoute]);

  async function handleSave() {
    setError(null);
    const hostPort =
      hostPortInput.trim() === ""
        ? null
        : Number.parseInt(hostPortInput.trim(), 10);
    if (hostPortInput.trim() !== "" && !Number.isInteger(hostPort)) {
      setError("Host port must be a whole number");
      return;
    }

    const payload = {
      hostPort,
      caddyRoute: caddyEnabled
        ? {
            enabled: true,
            routeKey: caddyRoute.routeKey,
            route: caddyRoute.route,
          }
        : caddyRoute.routeKey
          ? { ...caddyRoute, enabled: false }
          : null,
      linkedRouteKeys,
    };

    const ok = await onSave(payload);
    if (ok) setDirty(false);
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800 px-4 py-4 sm:px-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
          Host / port &amp; Caddy
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Compose project{" "}
          <span className="font-mono text-zinc-300">
            {values.composeProjectName}
          </span>
          . Deploy scripts receive{" "}
          <span className="font-mono text-zinc-300">--project-name</span>
          {resolvedPort ? (
            <>
              {" "}
              and{" "}
              <span className="font-mono text-zinc-300">
                --host-port {resolvedPort}
              </span>
            </>
          ) : (
            " (no host port set — scripts default to 3000)"
          )}
          .
        </p>
      </div>

      <div className="space-y-6 px-4 py-4 sm:px-5 sm:py-5">
        {error && (
          <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Host port
            </span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={hostPortInput}
              onChange={(e) => {
                setDirty(true);
                setHostPortInput(e.target.value);
              }}
              placeholder={
                values.resolvedHostPort
                  ? String(values.resolvedHostPort)
                  : "e.g. 3456"
              }
              disabled={disabled || saving}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
            />
            <span className="mt-1 block text-xs text-zinc-600">
              Passed to build, test, deploy, and teardown as{" "}
              <span className="font-mono">--host-port</span>.
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-400">
              Effective port
            </span>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-300">
              {Number.isInteger(resolvedPort) ? resolvedPort : "—"}
            </div>
          </label>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-zinc-300">
            Associated Caddy routes
          </h3>
          {associatedRoutes.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No routes linked yet. Enable a managed route below or associate
              existing routes from global settings.
            </p>
          ) : (
            <ul className="space-y-2">
              {associatedRoutes.map((route) => (
                <li
                  key={route.key}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5"
                >
                  <p className="font-mono text-xs text-zinc-500">
                    {route.key} · {route.serverName}
                    {route.key === caddyRoute.routeKey ? " · managed" : ""}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-200">
                    {routeDisplayLabel(route)}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {handlerSummary(route)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-zinc-300">
            Link existing routes
          </h3>
          <p className="text-xs text-zinc-500">
            Select one or more routes from the live Caddy config. Route
            definitions are edited under Global settings → Routes.
          </p>
          <ProjectCaddyRouteAssociation
            routes={liveRoutes}
            linkedRouteKeys={linkedRouteKeys}
            managedRouteKey={caddyRoute.routeKey}
            disabled={disabled || saving}
            onChange={(keys) => {
              setDirty(true);
              setLinkedRouteKeys(keys);
            }}
          />
        </div>

        <div className="space-y-3 border-t border-zinc-800 pt-5">
          <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={caddyEnabled}
              onChange={(e) => {
                setDirty(true);
                setCaddyEnabled(e.target.checked);
              }}
              disabled={disabled || saving}
              className="rounded border-zinc-600 bg-zinc-950 text-orange-500 focus:ring-orange-500/40"
            />
            Manage a Forge-owned reverse-proxy route for this project
          </label>

          {caddyEnabled && (
            <CaddyRouteForm
              values={caddyRoute.route}
              servers={servers}
              onChange={(route) => {
                setDirty(true);
                setCaddyRoute((prev) => ({ ...prev, route }));
              }}
              disabled={disabled || saving}
              showActions={false}
              formClassName={
                compact
                  ? "space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4"
                  : "space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4"
              }
              datalistId={`caddy-server-names-${projectId}`}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled || saving || !dirty}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save routing"}
          </button>
        </div>
      </div>
    </section>
  );
}
