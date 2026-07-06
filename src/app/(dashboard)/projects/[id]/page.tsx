"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  formatDuration,
  formatRelativeTime,
  runtimeStatusBadgeColor,
  runtimeStatusColor,
  runtimeStatusLabel,
  shortSha,
  statusColor,
} from "@/lib/utils";
import type { RuntimeStatus } from "@/lib/project-status";
import { AgentWorkspace } from "@/components/AgentWorkspace";

type ProjectTab = "deploy" | "agents";

const DEPLOYMENTS_PER_PAGE = 10;

interface ContainerInfo {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
}

interface Deployment {
  id: string;
  commitSha: string | null;
  branch: string;
  status: string;
  trigger: string;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface ProjectDetail {
  project: {
    id: string;
    name: string;
    githubRepo: string;
    branch: string;
    clonePath: string;
    lastSeenCommit: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
  deployments: Deployment[];
  currentDeployment: Deployment | null;
  containers: ContainerInfo[];
  isDeploying: boolean;
  runtimeStatus: RuntimeStatus;
  hasComposeFile: boolean;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedDeploymentId, setExpandedDeploymentId] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<ProjectTab>("deploy");
  const [deploymentPage, setDeploymentPage] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const json = (await res.json()) as ProjectDetail;
      setData(json);
      setExpandedDeploymentId((prev) => {
        if (prev && json.deployments.some((d) => d.id === prev)) return prev;
        const inProgress = json.deployments.find(
          (d) =>
            d.status === "pending" ||
            d.status === "pulling" ||
            d.status === "building" ||
            d.status === "testing" ||
            d.status === "deploying",
        );
        return inProgress?.id ?? prev ?? json.deployments[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  function toggleDeployment(deploymentId: string) {
    setExpandedDeploymentId((prev) => (prev === deploymentId ? null : deploymentId));
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function deployNow() {
    setActionLoading(true);
    try {
      await fetch(`/api/projects/${id}/deploy`, { method: "POST" });
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  async function toggleEnabled() {
    if (!data) return;
    setActionLoading(true);
    try {
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !data.project.enabled }),
      });
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  async function stopProject() {
    if (
      !confirm(
        "Stop all containers for this project? This runs teardown.sh.",
      )
    ) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/stop`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to stop project");
        return;
      }
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  async function deleteProject() {
    if (!confirm("Remove this project from Forge? This will not stop running containers.")) {
      return;
    }
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    router.push("/projects");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-0 flex-1 p-8 text-zinc-500">Project not found</div>
    );
  }

  const { project, deployments, currentDeployment, containers, isDeploying, runtimeStatus, hasComposeFile } =
    data;

  const deployedAt = currentDeployment?.completedAt ?? currentDeployment?.startedAt;

  const deploymentPageCount = Math.max(
    1,
    Math.ceil(deployments.length / DEPLOYMENTS_PER_PAGE),
  );
  const safeDeploymentPage = Math.min(deploymentPage, deploymentPageCount - 1);
  const paginatedDeployments = deployments.slice(
    safeDeploymentPage * DEPLOYMENTS_PER_PAGE,
    safeDeploymentPage * DEPLOYMENTS_PER_PAGE + DEPLOYMENTS_PER_PAGE,
  );
  const deploymentRangeStart =
    deployments.length === 0 ? 0 : safeDeploymentPage * DEPLOYMENTS_PER_PAGE + 1;
  const deploymentRangeEnd = Math.min(
    (safeDeploymentPage + 1) * DEPLOYMENTS_PER_PAGE,
    deployments.length,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6 lg:p-8">
      <div className="mb-4 flex shrink-0 flex-col gap-4 sm:mb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-xl font-semibold text-zinc-100 sm:text-2xl">
              {project.name}
            </h1>
            <span
              className={`inline-flex rounded border px-2.5 py-0.5 text-xs font-medium ${runtimeStatusBadgeColor(runtimeStatus)}`}
            >
              {runtimeStatusLabel(runtimeStatus)}
            </span>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500 sm:text-sm">
            {project.githubRepo} · branch{" "}
            <span className="text-orange-400">{project.branch}</span>
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          <TabButton
            active={activeTab === "deploy"}
            onClick={() => setActiveTab("deploy")}
          >
            Deploy
          </TabButton>
          <TabButton
            active={activeTab === "agents"}
            onClick={() => setActiveTab("agents")}
          >
            Agents
          </TabButton>
        </div>
      </div>

      {activeTab === "deploy" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={deployNow}
              disabled={actionLoading || isDeploying}
              className="min-h-11 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
            >
              {isDeploying ? "Deploying…" : "Deploy now"}
            </button>
            <button
              onClick={toggleEnabled}
              disabled={actionLoading}
              className="min-h-11 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {project.enabled ? "Pause watching" : "Resume watching"}
            </button>
            <button
              onClick={stopProject}
              disabled={actionLoading || isDeploying}
              className="min-h-11 rounded-lg border border-amber-400/20 px-4 py-2.5 text-sm text-amber-400 hover:bg-amber-400/10 disabled:opacity-50"
            >
              Stop containers
            </button>
            <button
              onClick={deleteProject}
              className="min-h-11 rounded-lg border border-red-400/20 px-4 py-2.5 text-sm text-red-400 hover:bg-red-400/10"
            >
              Remove project
            </button>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Current branch" value={project.branch} />
            <StatCard
              label="Deployed commit"
              value={shortSha(currentDeployment?.commitSha ?? project.lastSeenCommit)}
              mono
            />
            <StatCard
              label="Last deployed"
              value={deployedAt ? formatRelativeTime(deployedAt) : "Never"}
            />
            <StatCard
              label="Status"
              value={runtimeStatusLabel(runtimeStatus)}
              valueClassName={runtimeStatusColor(runtimeStatus)}
              subtitle={
                runtimeStatus === "running" && deployedAt
                  ? `Up ${formatDuration(deployedAt)}`
                  : runtimeStatus === "stopped"
                    ? "Containers are down"
                    : runtimeStatus === "partial"
                      ? `${containers.filter((c) => c.state === "running").length}/${containers.length} services running`
                      : undefined
              }
            />
          </div>

          {hasComposeFile && runtimeStatus === "stopped" && (
            <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-6 text-center">
              <p className="text-sm text-zinc-400">
                All containers are stopped. Use{" "}
                <span className="text-orange-400">Deploy now</span> to start them again.
              </p>
            </section>
          )}

          {containers.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
                Containers
              </h2>
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="bg-zinc-950 text-left text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Service</th>
                      <th className="px-4 py-3 font-medium">State</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Ports</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 bg-zinc-900">
                    {containers.map((c) => (
                      <tr key={`${c.service}-${c.name}`}>
                        <td className="px-4 py-3 font-medium text-zinc-200">
                          {c.service}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded border px-2 py-0.5 text-xs capitalize ${
                              c.state === "running"
                                ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
                                : "text-zinc-400 bg-zinc-400/10 border-zinc-400/20"
                            }`}
                          >
                            {c.state}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.status}</td>
                        <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                          {c.ports || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
              Deployment history
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
                            {d.branch !== project.branch && (
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
                          onClick={() =>
                            setDeploymentPage((page) => Math.max(0, page - 1))
                          }
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
                            setDeploymentPage((page) =>
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
        </div>
      ) : (
        <AgentWorkspace projectId={id} className="min-h-0 flex-1" />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 flex-1 rounded-md px-4 text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({
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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-semibold text-zinc-100 ${mono ? "font-mono text-base" : ""} ${valueClassName ?? ""}`}
      >
        {value}
      </div>
      {subtitle && (
        <div className="mt-0.5 text-xs text-zinc-500">{subtitle}</div>
      )}
    </div>
  );
}
