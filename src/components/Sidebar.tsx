"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { APP_DISPLAY_NAME, appDisplayInitial } from "@/lib/app-name";
import type { RuntimeStatus } from "@/lib/project-status";
import { runtimeTone } from "@/lib/ui-status";
import { projectSwatch } from "@/lib/project-swatch";
import { Kbd, StatusDot } from "@/components/ui";

interface ProjectSummary {
  id: string;
  name: string;
  branch: string;
  enabled: boolean;
  isDeploying: boolean;
  runtimeStatus: RuntimeStatus;
  isForge?: boolean;
  latestDeployment: { status: string } | null;
}

interface ProjectsResponse {
  forgeProject: ProjectSummary | null;
  projects: ProjectSummary[];
  forgeConfigured: boolean;
}

function ProjectNavLink({
  project,
  active,
  onNavigate,
  variant = "default",
}: {
  project: ProjectSummary;
  active: boolean;
  onNavigate?: () => void;
  variant?: "default" | "forge";
}) {
  const swatch = projectSwatch(project.id);
  const tone = !project.enabled
    ? "neutral"
    : project.isDeploying
      ? "warning"
      : runtimeTone(project.runtimeStatus);

  return (
    <Link
      href={`/projects/${project.id}?tab=overview`}
      onClick={onNavigate}
      className={`group relative flex min-h-10 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] transition-colors ${
        active
          ? "bg-[color-mix(in_srgb,var(--forge-accent)_14%,transparent)] text-[var(--forge-bright)]"
          : "text-[var(--forge-muted)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--forge-bright)]"
      }`}
    >
      <span
        className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full opacity-90"
        style={swatch.stripeStyle}
        aria-hidden
      />
      <StatusDot
        tone={tone}
        pulse={project.isDeploying}
        className="ml-1.5"
      />
      <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
      {variant === "forge" ? (
        <span className="forge-status-pill forge-tone-accent !px-1.5 !py-0 text-[9px]">
          Self
        </span>
      ) : null}
    </Link>
  );
}

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

export function Sidebar({ className = "", onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [forgeProject, setForgeProject] = useState<ProjectSummary | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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
  }, [fetchProjects, pathname]);

  async function logout() {
    await fetch("/api/auth/login", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={`forge-sidebar flex h-full min-h-0 w-[15.5rem] shrink-0 flex-col overflow-hidden ${className}`}
    >
      <div className="border-b border-[var(--forge-line)] px-4 py-4">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--forge-accent-muted)] text-sm font-bold text-[var(--forge-accent-hot)] ring-1 ring-[color-mix(in_srgb,var(--forge-accent)_35%,transparent)]">
            {appDisplayInitial()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-[var(--forge-bright)]">
              {APP_DISPLAY_NAME}
            </div>
            <div className="text-[11px] text-[var(--forge-faint)]">
              Deploy orchestrator
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event("forge:open-palette"));
          }}
          className="mt-3 flex w-full items-center justify-between rounded-[10px] border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2 text-xs text-[var(--forge-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--forge-accent)_40%,transparent)] hover:text-[var(--forge-bright)]"
        >
          <span>Search commands…</span>
          <span className="flex gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <Link
          href="/"
          onClick={onNavigate}
          className={`mb-3 flex min-h-9 items-center rounded-[10px] px-3 text-[13px] font-medium transition-colors ${
            pathname === "/"
              ? "bg-[color-mix(in_srgb,var(--forge-accent)_14%,transparent)] text-[var(--forge-bright)]"
              : "text-[var(--forge-muted)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--forge-bright)]"
          }`}
        >
          Command center
        </Link>

        {forgeProject ? (
          <div className="mb-4">
            <div className="forge-section-label mb-1.5 px-2">
              {APP_DISPLAY_NAME}
            </div>
            <ProjectNavLink
              project={forgeProject}
              active={pathname === `/projects/${forgeProject.id}`}
              onNavigate={onNavigate}
              variant="forge"
            />
          </div>
        ) : null}

        <div className="mb-1.5 flex items-center justify-between px-2">
          <span className="forge-section-label mb-0">Projects</span>
          <Link
            href="/projects/new"
            onClick={onNavigate}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[var(--forge-accent)] hover:bg-[var(--forge-accent-muted)]"
          >
            + Add
          </Link>
        </div>

        {!loaded ? (
          <div className="space-y-2 px-1 py-1">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-[10px] bg-[rgba(255,255,255,0.04)]"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="px-2 text-xs text-[var(--forge-faint)]">No projects yet</p>
        ) : (
          <ul className="space-y-0.5">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectNavLink
                  project={project}
                  active={pathname === `/projects/${project.id}`}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-[var(--forge-line)] p-2.5">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={`flex min-h-10 items-center rounded-[10px] px-3 text-[13px] transition-colors ${
            pathname === "/settings"
              ? "bg-[rgba(255,255,255,0.06)] text-[var(--forge-bright)]"
              : "text-[var(--forge-muted)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--forge-bright)]"
          }`}
        >
          Global settings
        </Link>
        <button
          type="button"
          onClick={logout}
          className="flex min-h-10 w-full items-center rounded-[10px] px-3 text-left text-[13px] text-[var(--forge-muted)] transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--forge-bright)]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
