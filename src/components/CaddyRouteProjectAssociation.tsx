"use client";

import Link from "next/link";
import { useState } from "react";
import type { RouteProjectLink } from "@/lib/project-routing";

interface ProjectOption {
  id: string;
  name: string;
}

export function CaddyRouteProjectAssociation({
  routeKey,
  linkedProjects,
  projects,
  disabled = false,
  onLinkChange,
}: {
  routeKey: string;
  linkedProjects: RouteProjectLink[];
  projects: ProjectOption[];
  disabled?: boolean;
  onLinkChange: (
    projectId: string,
    linked: boolean,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const managed = linkedProjects.filter((entry) => entry.kind === "managed");
  const linked = linkedProjects.filter((entry) => entry.kind === "linked");
  const linkedIds = new Set(linkedProjects.map((entry) => entry.id));

  async function toggleProject(projectId: string, nextLinked: boolean) {
    setBusyProjectId(projectId);
    setError(null);
    try {
      const ok = await onLinkChange(projectId, nextLinked);
      if (!ok) {
        setError("Failed to update project link");
      }
    } finally {
      setBusyProjectId(null);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Projects
        </span>
        {managed.map((entry) => (
          <Link
            key={`${entry.id}-managed`}
            href={`/projects/${entry.id}?tab=config`}
            className="rounded-full border border-orange-400/30 bg-orange-400/10 px-2.5 py-0.5 text-xs text-orange-200 hover:bg-orange-400/20"
          >
            {entry.name} · managed
          </Link>
        ))}
        {linked.map((entry) => (
          <Link
            key={`${entry.id}-linked`}
            href={`/projects/${entry.id}?tab=config`}
            className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-0.5 text-xs text-zinc-300 hover:border-zinc-600"
          >
            {entry.name}
          </Link>
        ))}
        {linkedProjects.length === 0 && (
          <span className="text-xs text-zinc-600">Not linked to any project</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={disabled || projects.length === 0}
          className="ml-auto text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
        >
          {open ? "Done" : "Associate projects"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && (
        <ul className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
          {projects.map((project) => {
            const isManaged = managed.some((entry) => entry.id === project.id);
            const checked = linkedIds.has(project.id);
            return (
              <li key={project.id}>
                <label
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    isManaged
                      ? "cursor-not-allowed text-zinc-500"
                      : "cursor-pointer text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked || isManaged}
                    disabled={disabled || isManaged || busyProjectId === project.id}
                    onChange={(event) =>
                      void toggleProject(project.id, event.target.checked)
                    }
                    className="rounded border-zinc-600 bg-zinc-950 text-orange-500 focus:ring-orange-500/40"
                  />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {isManaged && (
                    <span className="text-[10px] uppercase tracking-wide text-orange-300/80">
                      managed
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Route key{" "}
        <span className="font-mono text-zinc-500">{routeKey}</span>. Links sync
        with each project&apos;s Config &amp; history tab.
      </p>
    </div>
  );
}
