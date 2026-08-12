"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ServiceDirectoryApiRow } from "@/lib/service-directory-types";
import { formatRelativeTime } from "@/lib/utils";
import { Badge, SectionLabel } from "@/components/ui";

type ServicesResponse = {
  services: ServiceDirectoryApiRow[];
};

function serviceStatusTone(status: string): "success" | "danger" | "neutral" {
  switch (status) {
    case "up":
      return "success";
    case "down":
      return "danger";
    default:
      return "neutral";
  }
}

function routeTone(
  routeStatus: ServiceDirectoryApiRow["routeStatus"],
): "neutral" | "success" | "danger" {
  switch (routeStatus) {
    case "synced":
      return "success";
    case "error":
      return "danger";
    case "none":
      return "neutral";
    default: {
      const _exhaustive: never = routeStatus;
      return _exhaustive;
    }
  }
}

export function DeployTargetPorts({
  projectId,
  title = "Services",
  className = "",
}: {
  projectId?: string;
  title?: string;
  className?: string;
}) {
  const [services, setServices] = useState<ServiceDirectoryApiRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchServices = useCallback(() => {
    const qs = projectId
      ? `?projectId=${encodeURIComponent(projectId)}`
      : "";
    fetch(`/api/services${qs}`)
      .then((r) => r.json())
      .then((data: ServicesResponse) => {
        setServices(data.services ?? []);
        setLoaded(true);
      })
      .catch(() => {
        setServices([]);
        setLoaded(true);
      });
  }, [projectId]);

  useEffect(() => {
    fetchServices();
    const interval = setInterval(fetchServices, 5000);
    return () => clearInterval(interval);
  }, [fetchServices]);

  if (loaded && services.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <SectionLabel>
        {title}
        {loaded ? ` · ${services.length}` : ""}
      </SectionLabel>
      {!loaded ? (
        <div className="h-24 animate-pulse rounded-2xl bg-[var(--forge-panel)]" />
      ) : (
        <div className="forge-surface overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--forge-line)] text-[11px] uppercase tracking-wide text-[var(--forge-faint)]">
                {!projectId ? <th className="px-4 py-3 font-medium">Project</th> : null}
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Port</th>
                <th className="px-4 py-3 font-medium">Public</th>
                <th className="px-4 py-3 font-medium">URL</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Checked</th>
              </tr>
            </thead>
            <tbody>
              {services.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--forge-line)]/70 last:border-0"
                >
                  {!projectId ? (
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/projects/${row.projectId}?tab=overview`}
                        className="font-medium text-[var(--forge-bright)] hover:text-white"
                      >
                        {row.projectName}
                      </Link>
                    </td>
                  ) : null}
                  <td className="px-4 py-2.5 font-mono text-[var(--forge-bright)]">
                    {row.deployTarget}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[var(--forge-muted)]">
                    {row.portName}
                    <span className="text-[var(--forge-faint)]"> · </span>
                    {row.boundPort ?? row.port}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--forge-muted)]">
                    {row.public ? "yes" : "no"}
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-2.5 font-mono text-xs text-[var(--forge-muted)]">
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--forge-accent)] hover:text-[var(--forge-accent-hot)]"
                      >
                        {row.url}
                      </a>
                    ) : (
                      row.subdomain ?? "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={serviceStatusTone(row.status)} className="normal-case">
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={routeTone(row.routeStatus)} className="normal-case">
                      {row.routeStatus}
                    </Badge>
                    {row.routeError ? (
                      <div
                        className="mt-1 max-w-[12rem] truncate text-[10px] text-[var(--forge-danger)]"
                        title={row.routeError}
                      >
                        {row.routeError}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--forge-muted)]">
                    {row.lastCheckedAt
                      ? formatRelativeTime(row.lastCheckedAt)
                      : "—"}
                    {row.lastLatencyMs != null ? (
                      <span className="text-[var(--forge-faint)]">
                        {" "}
                        · {row.lastLatencyMs}ms
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
