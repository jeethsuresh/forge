"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collectAttention,
  type FleetProject,
} from "@/lib/fleet-attention";
import { formatRelativeTime, runtimeStatusLabel } from "@/lib/utils";
import { runtimeTone, statusTone } from "@/lib/ui-status";
import { projectSwatch } from "@/lib/project-swatch";
import { Badge, Kbd, Panel, StatusDot } from "@/components/ui";

type ProjectsResponse = {
  forgeProject: FleetProject | null;
  projects: FleetProject[];
  forgeConfigured: boolean;
};

function FleetTile({ project }: { project: FleetProject }) {
  const swatch = projectSwatch(project.id);
  const latest = project.latestDeployment;
  const tone = project.isDeploying
    ? "warning"
    : runtimeTone(project.runtimeStatus);

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-forge-panel transition-colors hover:border-zinc-700"
      style={swatch.ringStyle}
    >
      <div className="flex flex-1 flex-col gap-3 p-4 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/projects/${project.id}?tab=overview`}
                className="truncate text-base font-semibold text-zinc-100 hover:text-white"
              >
                {project.name}
              </Link>
              {project.isForge && (
                <Badge tone="accent" className="uppercase tracking-wide">
                  Self
                </Badge>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-zinc-500">
              {project.githubRepo ?? "—"} · {project.branch}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusDot
              tone={tone}
              pulse={tone === "warning" && project.isDeploying}
              title={runtimeStatusLabel(project.runtimeStatus)}
            />
            <Badge tone={tone}>{runtimeStatusLabel(project.runtimeStatus)}</Badge>
          </div>
        </div>

        <div className="text-xs text-zinc-500">
          {latest ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(latest.status)} className="capitalize">
                {latest.status}
              </Badge>
              {"startedAt" in latest && latest.startedAt ? (
                <span>{formatRelativeTime(latest.startedAt)}</span>
              ) : null}
            </span>
          ) : (
            <span>No deployments yet</span>
          )}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Link
            href={`/projects/${project.id}?tab=overview`}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Open
          </Link>
          <Link
            href={`/projects/${project.id}?tab=deploy`}
            className="inline-flex min-h-9 items-center justify-center rounded-lg bg-orange-500 px-3 text-xs font-semibold text-white hover:bg-orange-400"
          >
            Deploy
          </Link>
          <Link
            href={`/projects/${project.id}?tab=agents`}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-400/20"
          >
            Agents
          </Link>
        </div>
      </div>
    </div>
  );
}

export function HomeCommandCenter() {
  const [forgeProject, setForgeProject] = useState<FleetProject | null>(null);
  const [projects, setProjects] = useState<FleetProject[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: ProjectsResponse) => {
        setForgeProject(data.forgeProject ?? null);
        setProjects(data.projects ?? []);
        setLoaded(true);
      })
      .catch(() => {
        setForgeProject(null);
        setProjects([]);
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  const fleet = useMemo(() => {
    const list: FleetProject[] = [];
    if (forgeProject) list.push(forgeProject);
    list.push(...projects);
    return list;
  }, [forgeProject, projects]);

  const attention = useMemo(() => collectAttention(fleet), [fleet]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 sm:text-2xl">
            Home
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Fleet health, deploys, and agents — press{" "}
            <Kbd>⌘K</Kbd> / <Kbd>Ctrl+K</Kbd> to search
          </p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-400"
        >
          Add project
        </Link>
      </div>

      {attention.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-amber-400/90">
            Needs attention
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {attention.map(({ project, label, reason }) => (
              <Link
                key={`${project.id}-${reason}`}
                href={`/projects/${project.id}?tab=${reason === "failed_deploy" || reason === "deploying" || reason === "stopped" || reason === "partial" ? "deploy" : "overview"}`}
                className="flex items-center gap-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 transition-colors hover:bg-amber-400/10"
              >
                <StatusDot tone="warning" pulse={reason === "deploying"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-amber-100">
                    {project.name}
                  </div>
                  <div className="truncate text-xs text-amber-200/70">{label}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Projects
        </h2>
        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl bg-zinc-900/80"
              />
            ))}
          </div>
        ) : fleet.length === 0 ? (
          <Panel className="border-dashed px-8 py-16 text-center">
            <p className="text-zinc-400">No projects yet.</p>
            <Link
              href="/projects/new"
              className="mt-4 inline-block text-sm font-medium text-orange-400 hover:text-orange-300"
            >
              Add your first project →
            </Link>
          </Panel>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {fleet.map((project) => (
              <FleetTile key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
