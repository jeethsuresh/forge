"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ProjectSummary {
  id: string;
  name: string;
  branch: string;
  enabled: boolean;
  isDeploying: boolean;
  latestDeployment: { status: string } | null;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/login", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-5 py-4">
        <Link href="/projects" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/20 text-orange-400 font-bold text-sm">
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
          className="rounded-md px-2 py-1 text-xs font-medium text-orange-400 hover:bg-orange-400/10"
        >
          + Add
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {projects.length === 0 ? (
          <p className="px-2 text-sm text-zinc-600">No projects yet</p>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => {
              const active = pathname === `/projects/${project.id}`;
              const status = project.isDeploying
                ? "deploying"
                : (project.latestDeployment?.status ?? "unknown");

              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        !project.enabled
                          ? "bg-zinc-600"
                          : status === "success"
                            ? "bg-emerald-400"
                            : status === "failed"
                              ? "bg-red-400"
                              : "bg-amber-400 animate-pulse"
                      }`}
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
          className="w-full rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
