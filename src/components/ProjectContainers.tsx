"use client";

import { useCallback, useState } from "react";
import {
  containerRuntimeLabel,
  isContainerRunningState,
} from "@/lib/container-runtime";
import { Badge } from "@/components/ui";
import type { ContainerInfo } from "@/components/project-studio-types";

type LogView = {
  logs: string;
  inspectError: string | null;
  capturedAt: string;
  state: string;
  status: string;
};

export function ProjectContainers({
  projectId,
  containers,
  className = "",
}: {
  projectId: string;
  containers: ContainerInfo[];
  className?: string;
}) {
  const [openName, setOpenName] = useState<string | null>(null);
  const [logsByName, setLogsByName] = useState<Record<string, LogView | "loading" | "error">>({});

  const loadLogs = useCallback(
    async (containerName: string) => {
      setLogsByName((prev) => ({ ...prev, [containerName]: "loading" }));
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/containers/${encodeURIComponent(containerName)}/logs?refresh=1&tail=400`,
        );
        if (!res.ok) throw new Error("not found");
        const data = (await res.json()) as LogView;
        setLogsByName((prev) => ({ ...prev, [containerName]: data }));
      } catch {
        setLogsByName((prev) => ({ ...prev, [containerName]: "error" }));
      }
    },
    [projectId],
  );

  if (containers.length === 0) return null;

  return (
    <section className={className}>
      <div className="forge-section-label mb-3">Containers</div>
      <div className="forge-surface overflow-hidden">
        <ul className="divide-y divide-[var(--forge-line)]">
          {containers.map((c) => {
            const up = isContainerRunningState(c.state, c.status);
            const open = openName === c.name;
            const logState = logsByName[c.name];
            return (
              <li key={`${c.service}-${c.name}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--forge-hover)]"
                  onClick={() => {
                    const next = open ? null : c.name;
                    setOpenName(next);
                    if (next && logState !== "loading" && typeof logState !== "object") {
                      void loadLogs(c.name);
                    }
                  }}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--forge-bright)]">{c.service}</p>
                    <p className="truncate font-mono text-[11px] text-[var(--forge-faint)]">
                      {c.name}
                      {c.ports ? ` · ${c.ports}` : ""}
                    </p>
                  </div>
                  <Badge tone={up ? "success" : "danger"} className="normal-case">
                    {containerRuntimeLabel(c.state, c.status)}
                  </Badge>
                </button>
                {open ? (
                  <div className="border-t border-[var(--forge-line)] bg-black/20 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-[var(--forge-muted)]">
                      <span>{c.status || c.state}</span>
                      <button
                        type="button"
                        className="text-[var(--forge-accent)] hover:text-[var(--forge-accent-hot)]"
                        onClick={() => void loadLogs(c.name)}
                      >
                        Refresh logs
                      </button>
                    </div>
                    {logState === "loading" ? (
                      <p className="text-xs text-[var(--forge-muted)]">Loading logs…</p>
                    ) : logState === "error" ? (
                      <p className="text-xs text-[var(--forge-danger)]">
                        No logs captured yet. If the container failed to start, redeploy
                        or refresh after it exists.
                      </p>
                    ) : logState ? (
                      <>
                        {logState.inspectError ? (
                          <p className="mb-2 whitespace-pre-wrap text-xs text-[var(--forge-danger)]">
                            {logState.inspectError}
                          </p>
                        ) : null}
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--forge-muted)]">
                          {logState.logs.trim() || "No log output."}
                        </pre>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
