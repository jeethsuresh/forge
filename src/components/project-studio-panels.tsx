"use client";

import { formatRelativeTime, shortSha, statusColor } from "@/lib/utils";

export type StudioDeployment = {
  id: string;
  commitSha: string | null;
  branch: string;
  status: string;
  trigger: string;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export function DeploymentHistorySection({
  isForge,
  watchBranch,
  deployments,
  paginatedDeployments,
  expandedDeploymentId,
  toggleDeployment,
  deploymentPageCount,
  safeDeploymentPage,
  deploymentRangeStart,
  deploymentRangeEnd,
  onPageChange,
}: {
  isForge: boolean;
  watchBranch: string;
  deployments: StudioDeployment[];
  paginatedDeployments: StudioDeployment[];
  expandedDeploymentId: string | null;
  toggleDeployment: (deploymentId: string) => void;
  deploymentPageCount: number;
  safeDeploymentPage: number;
  deploymentRangeStart: number;
  deploymentRangeEnd: number;
  onPageChange: (page: number | ((page: number) => number)) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
        {isForge ? "Update history" : "Deployment history"}
      </h2>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        {deployments.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-600">
            No deployments yet
          </p>
        ) : (
          <>
            <ul className="divide-y divide-zinc-800">
              {paginatedDeployments.map((d) => {
                const expanded = expandedDeploymentId === d.id;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => toggleDeployment(d.id)}
                      aria-expanded={expanded}
                      className={`flex min-h-11 w-full flex-col gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-zinc-800/50 sm:flex-row sm:items-center sm:justify-between ${
                        expanded ? "bg-zinc-800/80" : ""
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
                        <span
                          className={`shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
                          aria-hidden
                        >
                          ›
                        </span>
                        <span
                          className={`rounded border px-2 py-0.5 text-xs font-medium capitalize ${statusColor(d.status)}`}
                        >
                          {d.status}
                        </span>
                        <span className="font-mono text-zinc-400">
                          {shortSha(d.commitSha)}
                        </span>
                        <span className="text-zinc-600">{d.trigger}</span>
                        {d.branch !== watchBranch && (
                          <span className="truncate font-mono text-xs text-orange-400/80">
                            {d.branch}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-zinc-500">
                        {formatRelativeTime(d.startedAt)}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-4">
                        {d.errorMessage && (
                          <p className="mb-3 text-sm text-red-400">{d.errorMessage}</p>
                        )}
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-400 sm:max-h-96">
                          {d.logs || "No logs recorded."}
                        </pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {deploymentPageCount > 1 && (
              <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
                <p className="text-xs text-zinc-500">
                  Showing {deploymentRangeStart}–{deploymentRangeEnd} of{" "}
                  {deployments.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPageChange((page) => Math.max(0, page - 1))}
                    disabled={safeDeploymentPage === 0}
                    className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-zinc-500">
                    Page {safeDeploymentPage + 1} of {deploymentPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onPageChange((page) =>
                        Math.min(deploymentPageCount - 1, page + 1),
                      )
                    }
                    disabled={safeDeploymentPage >= deploymentPageCount - 1}
                    className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  subtitle,
  mono,
  valueClassName,
}: {
  label: string;
  value: string;
  subtitle?: string;
  mono?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="forge-surface px-4 py-3">
      <div className="forge-section-label mb-1">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold text-[var(--forge-bright)] ${mono ? "font-mono text-base" : ""} ${valueClassName ?? ""}`}
      >
        {value}
      </div>
      {subtitle && (
        <div className="mt-0.5 text-xs text-[var(--forge-muted)]">{subtitle}</div>
      )}
    </div>
  );
}
