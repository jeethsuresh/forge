"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  formatDuration,
  formatRelativeTime,
  shortSha,
  statusColor,
} from "@/lib/utils";

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
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(
    null,
  );

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
      setSelectedDeployment((prev) => prev ?? json.deployments[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, [id]);

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
      <div className="flex h-full items-center justify-center p-8 text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-zinc-500">Project not found</div>
    );
  }

  const { project, deployments, currentDeployment, containers, isDeploying } =
    data;

  const deployedAt = currentDeployment?.completedAt ?? currentDeployment?.startedAt;

  return (
    <div className="p-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{project.name}</h1>
          <p className="mt-1 font-mono text-sm text-zinc-500">
            {project.githubRepo} · branch{" "}
            <span className="text-orange-400">{project.branch}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={deployNow}
            disabled={actionLoading || isDeploying}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
          >
            {isDeploying ? "Deploying…" : "Deploy now"}
          </button>
          <button
            onClick={toggleEnabled}
            disabled={actionLoading}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {project.enabled ? "Pause watching" : "Resume watching"}
          </button>
          <button
            onClick={deleteProject}
            className="rounded-lg border border-red-400/20 px-4 py-2 text-sm text-red-400 hover:bg-red-400/10"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Current branch"
          value={project.branch}
        />
        <StatCard
          label="Deployed commit"
          value={shortSha(currentDeployment?.commitSha ?? project.lastSeenCommit)}
          mono
        />
        <StatCard
          label="Deployed"
          value={deployedAt ? formatRelativeTime(deployedAt) : "Never"}
        />
        <StatCard
          label="Uptime"
          value={
            deployedAt && currentDeployment?.status === "success"
              ? formatDuration(deployedAt)
              : "—"
          }
        />
      </div>

      {containers.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
            Containers
          </h2>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-sm">
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
                  <tr key={c.name}>
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

      <div className="grid gap-6 lg:grid-cols-2">
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
              <ul className="divide-y divide-zinc-800">
                {deployments.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelectedDeployment(d)}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-zinc-800/50 ${
                        selectedDeployment?.id === d.id ? "bg-zinc-800/80" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded border px-2 py-0.5 text-xs font-medium capitalize ${statusColor(d.status)}`}
                        >
                          {d.status}
                        </span>
                        <span className="font-mono text-zinc-400">
                          {shortSha(d.commitSha)}
                        </span>
                        <span className="text-zinc-600">{d.trigger}</span>
                      </div>
                      <span className="text-zinc-500">
                        {formatRelativeTime(d.startedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
            Deployment logs
          </h2>
          <div className="h-96 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            {selectedDeployment ? (
              <>
                {selectedDeployment.errorMessage && (
                  <p className="mb-3 text-sm text-red-400">
                    {selectedDeployment.errorMessage}
                  </p>
                )}
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-400">
                  {selectedDeployment.logs || "No logs recorded."}
                </pre>
              </>
            ) : (
              <p className="text-sm text-zinc-600">
                Select a deployment to view logs
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-semibold text-zinc-100 ${mono ? "font-mono text-base" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
