"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ParsedRoute } from "@/lib/caddy-config";
import type { ProjectCaddySettings } from "@/lib/project-routing-shared";
import { ProjectRoutingEditor } from "@/components/ProjectRoutingEditor";

interface ProjectRoutingRow {
  id: string;
  name: string;
  composeProjectName: string;
  hostPort: number | null;
  caddyRoute: ProjectCaddySettings | null;
  linkedRouteKeys: string[];
  resolvedHostPort: number | null;
}

interface ProjectRoutingResponse {
  projects: ProjectRoutingRow[];
  caddy: {
    routes: ParsedRoute[];
  };
}

export function ProjectRoutingOverview() {
  const [data, setData] = useState<ProjectRoutingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    fetch("/api/settings/project-routing")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load (${res.status})`);
        }
        return res.json() as Promise<ProjectRoutingResponse>;
      })
      .then((payload) => {
        setData(payload);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load");
      });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function saveProject(
    projectId: string,
    payload: {
      hostPort: number | null;
      caddyRoute: ProjectCaddySettings | null;
      linkedRouteKeys: string[];
    },
  ): Promise<boolean> {
    setSavingId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? "Save failed");
      }
      fetchData();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-zinc-500">Loading project routing settings…</p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  const projects = data?.projects ?? [];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <p className="text-sm text-zinc-500">
        Associate one or more live Caddy routes with each project. Managed routes
        are created from the project editor; additional routes can be linked from
        the global Routes tab.
      </p>

      {projects.length === 0 ? (
        <p className="text-sm text-zinc-500">No projects yet.</p>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const expanded = expandedId === project.id;
            const routeCount =
              project.linkedRouteKeys.length +
              (project.caddyRoute?.enabled ? 1 : 0);
            const caddySummary =
              routeCount > 0
                ? `${routeCount} route${routeCount === 1 ? "" : "s"}`
                : "No routes";

            return (
              <div
                key={project.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(expanded ? null : project.id)
                  }
                  className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left sm:px-5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-100">
                        {project.name}
                      </span>
                      <span className="font-mono text-xs text-zinc-500">
                        {project.composeProjectName}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>
                        Port:{" "}
                        <span className="font-mono text-zinc-300">
                          {project.resolvedHostPort ?? "—"}
                        </span>
                      </span>
                      <span>Caddy: {caddySummary}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Link
                      href={`/projects/${project.id}?tab=config`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-orange-400 hover:text-orange-300"
                    >
                      Project settings
                    </Link>
                    <span className="text-xs text-zinc-500">
                      {expanded ? "Hide" : "Edit"}
                    </span>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-zinc-800 px-4 py-4 sm:px-5">
                    <ProjectRoutingEditor
                      projectId={project.id}
                      compact
                      values={{
                        hostPort: project.hostPort,
                        resolvedHostPort: project.resolvedHostPort,
                        composeProjectName: project.composeProjectName,
                        caddyRoute: project.caddyRoute,
                        linkedRouteKeys: project.linkedRouteKeys,
                      }}
                      saving={savingId === project.id}
                      onSave={(payload) => saveProject(project.id, payload)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
