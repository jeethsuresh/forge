"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { RuntimeStatus } from "@/lib/project-status";

interface ProjectSummary {
  id: string;
  name: string;
  branch: string;
  enabled: boolean;
  isDeploying: boolean;
  runtimeStatus: RuntimeStatus;
  latestDeployment: { status: string } | null;
}

function sidebarDotClass(
  enabled: boolean,
  runtimeStatus: RuntimeStatus,
): string {
  if (!enabled) return "bg-zinc-600";
  switch (runtimeStatus) {
    case "running":
      return "bg-emerald-400";
    case "stopped":
      return "bg-zinc-500";
    case "partial":
      return "bg-amber-400";
    case "deploying":
      return "bg-amber-400 animate-pulse";
    case "not_deployed":
      return "bg-zinc-600";
    case "unknown":
      return "bg-zinc-600";
    default: {
      const _exhaustive: never = runtimeStatus;
      return _exhaustive;
    }
  }
}

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

export function Sidebar({ className = "", onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        setProjects(data);
        setLoaded(true);
      })
      .catch(() => {
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
      className={`flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950 ${className}`}
    >
      <div className="border-b border-zinc-800 px-5 py-4">
        <Link
          href="/projects"
          onClick={onNavigate}
          className="flex items-center gap-2"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/20 text-sm font-bold text-orange-400">
            F
          </span>
          <div>
            <div className="font-semibold text-zinc-100">Forge</div>
            <div className="text-xs text-zinc-500">Deploy orchestrator</div>
          </div>
        </Link>
      </div>

      <div className="flex items-center justify-between px-5 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Projects
        </span>
        <Link
          href="/projects/new"
          onClick={onNavigate}
          className="rounded-md px-2 py-1 text-xs font-medium text-orange-400 hover:bg-orange-400/10"
        >
          + Add
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {!loaded ? (
          <div className="space-y-2 px-2 py-1">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-11 animate-pulse rounded-lg bg-zinc-800/60"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="px-2 text-sm text-zinc-600">No projects yet</p>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => {
              const active = pathname === `/projects/${project.id}`;

              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    onClick={onNavigate}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${sidebarDotClass(project.enabled, project.runtimeStatus)}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {project.name}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-zinc-800 p-4">
        <button
          onClick={logout}
          className="min-h-11 w-full rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
