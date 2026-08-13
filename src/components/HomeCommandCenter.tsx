"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  attentionForProject,
  collectAttention,
  type FleetProject,
} from "@/lib/fleet-attention";
import { formatRelativeTime, runtimeStatusLabel } from "@/lib/utils";
import { runtimeTone, statusTone } from "@/lib/ui-status";
import { projectSwatch } from "@/lib/project-swatch";
import { projectModeHref } from "@/lib/project-routes";
import {
  ActionLink,
  Badge,
  Kbd,
  PageHeader,
  SectionLabel,
  StatusDot,
} from "@/components/ui";
import { DeployTargetPorts } from "@/components/DeployTargetPorts";

type ProjectsResponse = {
  forgeProject: FleetProject | null;
  projects: FleetProject[];
  forgeConfigured: boolean;
};

function FleetTile({
  project,
  dense,
}: {
  project: FleetProject;
  dense: boolean;
}) {
  const swatch = projectSwatch(project.id);
  const latest = project.latestDeployment;
  const tone = project.isDeploying
    ? "warning"
    : runtimeTone(project.runtimeStatus);
  const latestStartedAt =
    latest && "startedAt" in latest ? latest.startedAt : undefined;
  const attention = attentionForProject(project);
  const primaryHref = attention?.href ?? projectModeHref(project.id, "overview");
  const primaryLabel = attention?.actionLabel ?? "Open";

  if (dense && !attention) {
    return (
      <article className="flex items-center gap-3 rounded-[12px] border border-[var(--forge-line)] bg-[var(--forge-panel)] px-4 py-3">
        <span
          className="h-8 w-1 shrink-0 rounded-full"
          style={swatch.stripeStyle}
          aria-hidden
        />
        <StatusDot tone={tone} pulse={Boolean(project.isDeploying)} />
        <Link
          href={projectModeHref(project.id, "overview")}
          className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--forge-muted)] hover:text-[var(--forge-bright)]"
        >
          {project.name}
        </Link>
        <span className="text-xs text-[var(--forge-faint)]">
          {runtimeStatusLabel(project.runtimeStatus)}
        </span>
      </article>
    );
  }

  return (
    <article
      className={`forge-hero-tile flex flex-col ${dense ? "min-h-0" : ""}`}
      style={{ ["--tile-accent" as string]: swatch.hex }}
    >
      <div
        className="absolute left-0 top-0 h-full w-1.5"
        style={swatch.stripeStyle}
        aria-hidden
      />
      <div className={`flex flex-1 flex-col gap-4 pl-6 ${dense ? "p-4" : "p-5"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={projectModeHref(project.id, "overview")}
                className="truncate text-xl font-semibold tracking-tight text-[var(--forge-bright)] hover:text-[var(--forge-bright)]"
              >
                {project.name}
              </Link>
              {project.isForge ? <Badge tone="accent">Self</Badge> : null}
            </div>
            <p className="mt-1.5 truncate font-mono text-[11px] text-[var(--forge-faint)]">
              {project.githubRepo ?? "local"} · {project.branch}
            </p>
          </div>
          <Badge tone={tone}>{runtimeStatusLabel(project.runtimeStatus)}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--forge-muted)]">
          <StatusDot
            tone={tone}
            pulse={Boolean(project.isDeploying)}
            title={runtimeStatusLabel(project.runtimeStatus)}
          />
          {attention ? (
            <span className="text-[var(--forge-warning)]">{attention.label}</span>
          ) : latest ? (
            <>
              <Badge tone={statusTone(latest.status)} className="normal-case">
                {latest.status}
              </Badge>
              {latestStartedAt ? (
                <span>{formatRelativeTime(latestStartedAt)}</span>
              ) : null}
            </>
          ) : (
            <span>No deployments yet</span>
          )}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--forge-line)] pt-4">
          <ActionLink href={primaryHref} variant="primary">
            {primaryLabel}
          </ActionLink>
          {!dense ? (
            <>
              <ActionLink href={projectModeHref(project.id, "deploy")}>
                Deploy
              </ActionLink>
              <ActionLink
                href={projectModeHref(project.id, "agents")}
                variant="info"
              >
                Agents
              </ActionLink>
            </>
          ) : null}
        </div>
      </div>
    </article>
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
  const busy = attention.length > 0;
  const runningCount = fleet.filter((p) => p.runtimeStatus === "running").length;
  const attentionIds = useMemo(
    () => new Set(attention.map((item) => item.project.id)),
    [attention],
  );

  return (
    <div className="forge-app-bg min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
      <PageHeader
        title="Command center"
        subtitle={
          <>
            {loaded
              ? busy
                ? `${attention.length} need attention · ${fleet.length} projects`
                : `${fleet.length} projects · all healthy · ${runningCount} running`
              : "Loading fleet…"}{" "}
            · press <Kbd>⌘K</Kbd> to jump anywhere
          </>
        }
        actions={
          <ActionLink href="/projects/new" variant="primary" className="min-h-11 px-4 text-sm">
            Add project
          </ActionLink>
        }
      />

      {attention.length > 0 ? (
        <section className="mb-9">
          <SectionLabel>Needs attention · {attention.length}</SectionLabel>
          <div className="grid gap-2 lg:grid-cols-2">
            {attention.map(({ project, label, reason, href, actionLabel }) => {
              const swatch = projectSwatch(project.id);
              return (
                <Link
                  key={`${project.id}-${reason}`}
                  href={href}
                  className="forge-attention-row"
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={swatch.stripeStyle}
                    aria-hidden
                  />
                  <StatusDot tone="warning" pulse={reason === "deploying"} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--forge-bright)]">
                      {project.name}
                    </div>
                    <div className="truncate text-xs text-[var(--forge-warning)]">
                      {label}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-[var(--forge-muted)]">
                    {actionLabel} →
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <SectionLabel>Fleet</SectionLabel>
        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-2xl bg-[var(--forge-panel)]"
              />
            ))}
          </div>
        ) : fleet.length === 0 ? (
          <div className="forge-surface border-dashed px-8 py-20 text-center">
            <p className="text-[var(--forge-muted)]">No projects yet.</p>
            <Link
              href="/projects/new"
              className="mt-4 inline-block text-sm font-semibold text-[var(--forge-accent)] hover:text-[var(--forge-accent-hot)]"
            >
              Add your first project →
            </Link>
          </div>
        ) : busy ? (
          <div className="space-y-2">
            {fleet.map((project) => (
              <FleetTile
                key={project.id}
                project={project}
                dense={!attentionIds.has(project.id)}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {fleet.map((project) => (
              <FleetTile key={project.id} project={project} dense={false} />
            ))}
          </div>
        )}
      </section>

      <DeployTargetPorts className="mt-9" title="Services" />

      <p className="mt-4 text-sm text-[var(--forge-muted)]">
        File artifacts are built from each project&apos;s Forgefile — open a
        project Overview to build or download.
      </p>
    </div>
  );
}
