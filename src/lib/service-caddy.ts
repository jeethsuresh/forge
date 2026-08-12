import {
  getCaddyConfig,
  loadCaddyConfig,
} from "@/lib/caddy";
import {
  defaultRouteFormValues,
  parseHttpRoutes,
  upsertRouteInConfig,
  type RouteFormValues,
} from "@/lib/caddy-config";
import { defaultUpstreamDial } from "@/lib/project-routing-shared";
import {
  listServiceDirectory,
  setServiceRouteStatus,
} from "@/lib/service-directory";
import type { ServiceDirectoryRow } from "@/lib/db/schema";

export function forgePublicDomain(): string {
  return (
    process.env.FORGE_PUBLIC_DOMAIN?.trim() ||
    process.env.FORGE_DOMAIN?.trim() ||
    "localhost"
  );
}

export function buildServicePublicHost(subdomain: string): string {
  return `${subdomain.trim()}.${forgePublicDomain()}`;
}

export function buildServicePublicUrl(host: string): string {
  const lower = host.toLowerCase();
  const insecure =
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower);
  return `${insecure ? "http" : "https"}://${host}`;
}

function findRouteByHost(
  config: unknown,
  host: string,
): ReturnType<typeof parseHttpRoutes>[number] | null {
  const needle = host.toLowerCase();
  return (
    parseHttpRoutes(config).find((route) =>
      route.hosts.some((h) => h.toLowerCase() === needle),
    ) ?? null
  );
}

function routeFormForService(
  host: string,
  upstreamPort: number,
): RouteFormValues {
  return {
    ...defaultRouteFormValues("srv0"),
    handlerKind: "reverse_proxy",
    hosts: host,
    paths: "/",
    upstreamDial: defaultUpstreamDial(upstreamPort),
  };
}

async function syncOnePublicRoute(row: ServiceDirectoryRow): Promise<void> {
  const subdomain = row.subdomain?.trim();
  if (!subdomain) {
    setServiceRouteStatus({
      projectId: row.projectId,
      deployTarget: row.deployTarget,
      portName: row.portName,
      routeStatus: "none",
      routeError: null,
      url: null,
    });
    return;
  }

  const host = buildServicePublicHost(subdomain);
  const upstreamPort = row.boundPort ?? row.port;
  const values = routeFormForService(host, upstreamPort);

  const config = await getCaddyConfig();
  const existing = findRouteByHost(config, host);
  const next = upsertRouteInConfig(
    config,
    values,
    existing
      ? {
          serverName: existing.serverName,
          index: existing.index,
          subroute: existing.subroute,
        }
      : undefined,
  );
  await loadCaddyConfig(next);

  setServiceRouteStatus({
    projectId: row.projectId,
    deployTarget: row.deployTarget,
    portName: row.portName,
    routeStatus: "synced",
    routeError: null,
    url: buildServicePublicUrl(host),
  });
}

export async function syncDeployTargetCaddyRoutes(
  projectId: string,
  deployTarget: string,
): Promise<void> {
  const rows = listServiceDirectory({ projectId }).filter(
    (row) => row.deployTarget === deployTarget,
  );

  for (const row of rows) {
    if (!row.public) {
      setServiceRouteStatus({
        projectId: row.projectId,
        deployTarget: row.deployTarget,
        portName: row.portName,
        routeStatus: "none",
        routeError: null,
        url: null,
      });
      continue;
    }

    if (!row.subdomain?.trim()) {
      setServiceRouteStatus({
        projectId: row.projectId,
        deployTarget: row.deployTarget,
        portName: row.portName,
        routeStatus: "none",
        routeError: null,
        url: null,
      });
      continue;
    }

    try {
      await syncOnePublicRoute(row);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setServiceRouteStatus({
        projectId: row.projectId,
        deployTarget: row.deployTarget,
        portName: row.portName,
        routeStatus: "error",
        routeError: message,
      });
    }
  }
}

