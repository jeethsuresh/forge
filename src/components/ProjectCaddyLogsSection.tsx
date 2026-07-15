"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParsedRoute } from "@/lib/caddy-config";
import type { ProjectCaddySettings } from "@/lib/project-routing-shared";
import {
  collectProjectLogHosts,
  resolveRoutesByKeys,
} from "@/lib/project-routing-shared";
import { ProjectCaddyLogsPanel } from "@/components/ProjectCaddyLogsPanel";

interface ProjectCaddyLogsSectionProps {
  projectId: string;
  caddyRoute: ProjectCaddySettings | null;
  linkedRouteKeys: string[];
  className?: string;
}

function readExpandedPref(key: string, defaultExpanded: boolean): boolean {
  if (typeof window === "undefined") return defaultExpanded;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return defaultExpanded;
}

export function ProjectCaddyLogsSection({
  projectId,
  caddyRoute,
  linkedRouteKeys,
  className = "",
}: ProjectCaddyLogsSectionProps) {
  const collapseKey = `forge:config-collapse:${projectId}:caddy-logs`;
  const [expanded, setExpanded] = useState(() =>
    readExpandedPref(collapseKey, false),
  );
  const [liveRoutes, setLiveRoutes] = useState<ParsedRoute[]>([]);

  const loadRoutes = useCallback(() => {
    fetch("/api/caddy/config")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load Caddy routes");
        const data = (await res.json()) as { routes?: ParsedRoute[] };
        setLiveRoutes(data.routes ?? []);
      })
      .catch(() => {
        setLiveRoutes([]);
      });
  }, []);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  const linkedRoutes = useMemo(
    () => resolveRoutesByKeys(linkedRouteKeys, liveRoutes),
    [linkedRouteKeys, liveRoutes],
  );

  const logHosts = useMemo(
    () => collectProjectLogHosts(caddyRoute, linkedRoutes),
    [caddyRoute, linkedRoutes],
  );

  const summary =
    logHosts.length > 0
      ? `${logHosts.length} host${logHosts.length === 1 ? "" : "s"}`
      : "no associated hosts";

  return (
    <section
      className={`mb-8 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 ${className}`}
    >
      <button
        type="button"
        onClick={() => {
          setExpanded((open) => {
            const next = !open;
            try {
              window.localStorage.setItem(collapseKey, next ? "1" : "0");
            } catch {
              // ignore
            }
            return next;
          });
        }}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/50"
      >
        <span
          className={`shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        >
          ›
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Caddy access logs
          </h2>
          <p className="mt-0.5 text-xs text-zinc-600">{summary}</p>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-4">
          <ProjectCaddyLogsPanel hosts={logHosts} />
        </div>
      )}
    </section>
  );
}
