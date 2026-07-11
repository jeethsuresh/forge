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
  caddyRoute: ProjectCaddySettings | null;
  linkedRouteKeys: string[];
  className?: string;
}

export function ProjectCaddyLogsSection({
  caddyRoute,
  linkedRouteKeys,
  className = "",
}: ProjectCaddyLogsSectionProps) {
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

  return (
    <section className={`mb-8 ${className}`}>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
        Caddy access logs
      </h2>
      <ProjectCaddyLogsPanel hosts={logHosts} />
    </section>
  );
}
