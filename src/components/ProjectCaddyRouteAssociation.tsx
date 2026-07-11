"use client";

import type { ParsedRoute } from "@/lib/caddy-config";
import { routeDisplayLabel } from "@/lib/project-routing-shared";

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

export function ProjectCaddyRouteAssociation({
  routes,
  linkedRouteKeys,
  managedRouteKey,
  disabled = false,
  onChange,
}: {
  routes: ParsedRoute[];
  linkedRouteKeys: string[];
  managedRouteKey?: string | null;
  disabled?: boolean;
  onChange: (keys: string[]) => void;
}) {
  const selectable = routes.filter((route) => route.key !== managedRouteKey);

  function toggleRoute(routeKey: string) {
    if (disabled) return;
    const selected = new Set(linkedRouteKeys);
    if (selected.has(routeKey)) {
      selected.delete(routeKey);
    } else {
      selected.add(routeKey);
    }
    onChange([...selected]);
  }

  if (selectable.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No additional Caddy routes are available. Create routes under Global
        settings → Routes, then link them here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {selectable.map((route) => {
        const checked = linkedRouteKeys.includes(route.key);
        return (
          <li key={route.key}>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                checked
                  ? "border-orange-400/30 bg-orange-400/5"
                  : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
              } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleRoute(route.key)}
                disabled={disabled}
                className="mt-0.5 rounded border-zinc-600 bg-zinc-950 text-orange-500 focus:ring-orange-500/40"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs text-zinc-400">
                  {route.key} · {route.serverName}
                </span>
                <span className="mt-0.5 block text-sm text-zinc-200">
                  {routeDisplayLabel(route)}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {handlerSummary(route)}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
