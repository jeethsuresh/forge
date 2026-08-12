"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { mergePolledProjectDetail } from "@/lib/project-detail-client";
import { ForgeSelfUpdateEditor } from "@/components/ForgeSelfUpdateEditor";
import { ActiveDeployLogsPanel } from "@/components/ActiveDeployLogsPanel";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { resolveActiveDeployLogView } from "@/lib/active-deploy-logs";
import { ProjectRenameEditor } from "@/components/ProjectRenameEditor";
import { ProjectRoutingEditor } from "@/components/ProjectRoutingEditor";
import type { ProjectCaddySettings } from "@/lib/project-routing-shared";
import {
  DeployEnvVarsEditor,
  type DeployEnvVarRow,
} from "@/components/DeployEnvVarsEditor";
import { ProjectGitTreePanel } from "@/components/ProjectGitTreePanel";
import { ProjectDiffPanel } from "@/components/ProjectDiffPanel";
import { ProjectCaddyLogsSection } from "@/components/ProjectCaddyLogsSection";
import { ProjectLocalBranchesEditor } from "@/components/ProjectLocalBranchesEditor";
import { ForgefileStatusBanner } from "@/components/ForgefileStatusBanner";
import { DeployTargetPorts } from "@/components/DeployTargetPorts";
import {
  agentSessionSourceBadgeClass,
  agentSessionSourceLabel,
} from "@/lib/agent-session-source";
import { projectSwatch } from "@/lib/project-swatch";
import { statusTone } from "@/lib/ui-status";
import { Badge, Button, TabButton, TabList } from "@/components/ui";

const AgentWorkspace = dynamic(
  () =>
    import("@/components/AgentWorkspace").then((module) => ({
      default: module.AgentWorkspace,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-zinc-800 text-sm text-zinc-500">
        Loading agents…
      </div>
    ),
  },
);

type ProjectTab = "overview" | "deploy" | "settings" | "agents" | "diff";

function resolveProjectTab(tab: string | null): ProjectTab {
  if (tab === "config") return "settings";
  if (
    tab === "overview" ||
    tab === "deploy" ||
    tab === "settings" ||
    tab === "agents" ||
    tab === "diff"
  ) {
    return tab;
  }
  return "overview";
}

const DEPLOYMENTS_PER_PAGE = 10;

function projectPollIntervalMs(
  tab: ProjectTab,
  isDeploying: boolean,
): number | null {
  if (typeof document !== "undefined" && document.hidden) {
    return null;
  }
  if (tab === "agents" || tab === "diff") return 12_000;
  if (tab === "settings" && !isDeploying) return 12_000;
  if (isDeploying) return 5_000;
  return 10_000;
}

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
    deployEnvVars: DeployEnvVarRow[];
    deployEnvFileSource: ".env" | ".env.example" | null;
    composeProjectName?: string;
    hostPort?: number | null;
    resolvedHostPort?: number | null;
    caddyRoute?: ProjectCaddySettings | null;
    linkedRouteKeys?: string[];
    isForge?: boolean;
  };
  deployments: Deployment[];
  currentDeployment: Deployment | null;
  containers: ContainerInfo[];
  isDeploying: boolean;
  runtimeStatus: RuntimeStatus;
  hasComposeFile: boolean;
  branches: string[];
  supportsRollback: boolean;
  hasRollbackImage: boolean;
  forgeStatus: {
    configured: boolean;
    updateAvailable: boolean;
    hasRollbackImage: boolean;
    activeUpdate: {
      id: string;
      status: string;
      targetCommitSha: string | null;
      logs: string;
      errorMessage: string | null;
      startedAt: string;
    } | null;
    recentUpdates: Array<{
      id: string;
      status: string;
      trigger: string;
      targetCommitSha: string | null;
      startedAt: string;
      logs: string;
      errorMessage: string | null;
    }>;
  } | null;
  blockingAgentSession: {
    id: string;
    branch: string;
    status: string;
    sessionSource: "manual" | "recovery" | "rebase-recovery";
  } | null;
  deployUpdate: {
    branch: string;
    deployedCommitSha: string | null;
    remoteCommitSha: string | null;
    updateAvailable: boolean;
    deployAllowed: boolean;
    remoteCommitLookupFailed: boolean;
    reason: string;
  } | null;
}

type ForgefileStatus = {
  status: "missing" | "invalid" | "valid" | "unknown";
  errorMessage: string | null;
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [forgefileStatus, setForgefileStatus] = useState<ForgefileStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedDeploymentId, setExpandedDeploymentId] = useState<string | null>(
    null,
  );
  const [deploymentPage, setDeploymentPage] = useState(0);
  const [deployBranch, setDeployBranch] = useState<string | null>(null);
  const [envSaving, setEnvSaving] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [gitTreeOpen, setGitTreeOpen] = useState(false);
  const [deployMoreOpen, setDeployMoreOpen] = useState(false);
  const dataRef = useRef<ProjectDetail | null>(null);

  const initialAgentSessionId = searchParams.get("session");
  const rawTab = searchParams.get("tab");
  const activeTab = resolveProjectTab(rawTab);

  useEffect(() => {
    if (rawTab === "config") {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "settings");
      router.replace(`/projects/${id}?${params.toString()}`, { scroll: false });
    }
  }, [rawTab, searchParams, router, id]);

  const fetchData = useCallback(async (poll = false) => {
    try {
      const branch = deployBranch ?? dataRef.current?.project.branch;
      const params = new URLSearchParams();
      if (poll) params.set("poll", "1");
      if (branch) params.set("deployBranch", branch);
      const qs = params.toString();
      const [res, forgefileRes] = await Promise.all([
        fetch(qs ? `/api/projects/${id}?${qs}` : `/api/projects/${id}`),
        fetch(`/api/projects/${id}/forgefile`),
      ]);
      if (!res.ok) return;
      const json = (await res.json()) as ProjectDetail;
      setData((previous) => {
        const next = poll ? mergePolledProjectDetail(previous, json) : json;
        dataRef.current = next;
        return next;
      });
      if (forgefileRes.ok) {
        const forgefileJson = (await forgefileRes.json()) as ForgefileStatus;
        setForgefileStatus({
          status: forgefileJson.status,
          errorMessage: forgefileJson.errorMessage ?? null,
        });
      }
      setDeployBranch((prev) => {
        if (prev && json.branches.includes(prev)) return prev;
        return json.project.branch;
      });
      setExpandedDeploymentId((prev) => {
        if (prev && json.deployments.some((d) => d.id === prev)) return prev;
        const inProgress = json.deployments.find(
          (d) =>
            d.status === "pending" ||
            d.status === "pulling" ||
            d.status === "building" ||
            d.status === "testing" ||
            d.status === "staging" ||
            d.status === "deploying" ||
            d.status === "health_check",
        );
        return inProgress?.id ?? prev ?? json.deployments[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, [id, deployBranch]);

  function toggleDeployment(deploymentId: string) {
    setExpandedDeploymentId((prev) => (prev === deploymentId ? null : deploymentId));
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled) return;
      const interval = projectPollIntervalMs(
        activeTab,
        dataRef.current?.isDeploying ?? false,
      );
      if (interval === null) return;
      timer = setTimeout(async () => {
        await fetchData(true);
        schedule();
      }, interval);
    };

    const onVisibility = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (document.hidden) return;
      void fetchData(true);
      schedule();
    };

    void fetchData(false);
    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchData, activeTab]);

  async function deployNow() {
    if (!deployBranch) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: deployBranch }),
      });
      if (!res.ok) {
        const json = (await res.json()) as {
          error?: string;
          blockingAgentSession?: { id: string; branch: string; status: string } | null;
        };
        if (res.status === 409 && json.blockingAgentSession) {
          const { id: sessionId, branch, status } = json.blockingAgentSession;
          if (
            confirm(
              `${json.error ?? "Deploy blocked"}\n\nOpen the agent on branch ${branch} (${status})?`,
            )
          ) {
            openAgentSession(sessionId);
          }
        } else {
          alert(json.error ?? "Deploy failed");
        }
        return;
      }
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  function openAgentSession(sessionId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "agents");
    params.set("session", sessionId);
    router.replace(`/projects/${id}?${params.toString()}`, {
      scroll: false,
    });
  }

  async function endBlockingAgentSession() {
    const blocking = dataRef.current?.blockingAgentSession;
    if (!blocking) return;
    if (
      !confirm(
        "Stop this agent session? Deploys for this project will be unblocked.",
      )
    ) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${id}/agent-sessions/${blocking.id}/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revertChanges: false }),
        },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to stop agent session");
        return;
      }
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  function selectTab(tab: ProjectTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    if (tab !== "agents" && tab !== "diff") {
      params.delete("session");
      params.delete("mode");
      params.delete("base");
      params.delete("head");
      params.delete("branch");
      params.delete("source");
      params.delete("onto");
      params.delete("target");
      params.delete("file");
    }
    const query = params.toString();
    router.replace(query ? `/projects/${id}?${query}` : `/projects/${id}`, {
      scroll: false,
    });
  }

  async function saveDeployEnvVars(vars: DeployEnvVarRow[]): Promise<boolean> {
    setEnvSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployEnvVars: vars }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to save environment variables");
        return false;
      }
      await fetchData();
      return true;
    } finally {
      setEnvSaving(false);
    }
  }

  async function saveProjectRouting(payload: {
    hostPort: number | null;
    caddyRoute: ProjectCaddySettings | null;
    linkedRouteKeys: string[];
  }): Promise<boolean> {
    setRoutingSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Failed to save routing settings");
        return false;
      }
      await fetchData();
      return true;
    } finally {
      setRoutingSaving(false);
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

  async function rollbackProject() {
    if (
      !confirm(
        "Roll back to the previous working release? The current version will be replaced.",
      )
    ) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/rollback`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        alert(json.error ?? "Rollback failed");
        return;
      }
      await fetchData();
    } finally {
      setActionLoading(false);
    }
  }

  async function deleteProject() {
    if (!confirm(`Remove this project from ${APP_DISPLAY_NAME}? This will not stop running containers.`)) {
      return;
    }
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    router.push("/");
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

  const {
    project,
    deployments: projectDeployments,
    currentDeployment,
    containers,
    isDeploying,
    runtimeStatus,
    hasComposeFile,
    branches,
    supportsRollback,
    hasRollbackImage,
    forgeStatus,
    blockingAgentSession,
  } = data;

  const isForge = project.isForge === true;
  const forgeUpdateBusy = !!forgeStatus?.activeUpdate;
  const deployBusy = isForge ? forgeUpdateBusy : isDeploying;

  const forgeHistoryDeployments: Deployment[] =
    isForge && forgeStatus
      ? forgeStatus.recentUpdates.map((update) => ({
          id: update.id,
          commitSha: update.targetCommitSha,
          branch: project.branch,
          status: update.status,
          trigger: update.trigger === "rollback" ? "rollback" : "manual",
          logs: update.logs,
          errorMessage: update.errorMessage,
          startedAt: update.startedAt,
          completedAt: null,
        }))
      : [];

  const deployments =
    isForge && forgeHistoryDeployments.length > 0
      ? [
          ...forgeHistoryDeployments,
          ...projectDeployments.filter(
            (d) => !forgeHistoryDeployments.some((f) => f.id === d.id),
          ),
        ]
      : projectDeployments;

  const selectedDeployBranch = deployBranch ?? project.branch;
  const deployUpdate = data.deployUpdate;
  const updateAvailable = deployUpdate?.updateAvailable ?? false;
  const activeDeployLogs = resolveActiveDeployLogView({
    isForge,
    forgeTitle: `${APP_DISPLAY_NAME} update`,
    deployments,
    activeForgeUpdate: forgeStatus?.activeUpdate ?? null,
  });
  const deployPrimaryLabel = deployBusy
    ? updateAvailable
      ? "Updating…"
      : isForge
        ? "Redeploying…"
        : "Deploying…"
    : updateAvailable
      ? "Update"
      : isForge
        ? "Redeploy"
        : "Deploy now";

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
    <div className="forge-app-bg flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-7 sm:py-6 lg:px-10">
      <div className="mb-5 flex shrink-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="h-8 w-1.5 rounded-full shadow-[0_0_18px_currentColor]"
                style={{
                  ...projectSwatch(project.id).stripeStyle,
                  color: projectSwatch(project.id).hex,
                }}
                aria-hidden
              />
              <h1 className="forge-page-title">{project.name}</h1>
              <span className={runtimeStatusBadgeColor(runtimeStatus)}>
                {runtimeStatusLabel(runtimeStatus)}
              </span>
              {isForge ? (
                <span className="forge-status-pill forge-tone-accent">Self</span>
              ) : null}
            </div>
            <p className="mt-2 break-all font-mono text-xs text-[var(--forge-faint)] sm:text-[13px]">
              {project.githubRepo}
              <span className="mx-2 text-[var(--forge-line-strong)]">·</span>
              watch{" "}
              <span className="text-[var(--forge-accent-hot)]">{project.branch}</span>
            </p>
          </div>
        </div>

        <TabList>
          <TabButton
            active={activeTab === "overview"}
            onClick={() => selectTab("overview")}
          >
            Overview
          </TabButton>
          <TabButton
            active={activeTab === "deploy"}
            onClick={() => selectTab("deploy")}
          >
            Deploy
          </TabButton>
          <TabButton
            active={activeTab === "agents"}
            onClick={() => selectTab("agents")}
          >
            Agents
          </TabButton>
          <TabButton
            active={activeTab === "diff"}
            onClick={() => selectTab("diff")}
          >
            Changes
          </TabButton>
          <TabButton
            active={activeTab === "settings"}
            onClick={() => selectTab("settings")}
          >
            Settings
          </TabButton>
        </TabList>
      </div>

      {activeTab === "overview" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-5">
          {forgefileStatus && forgefileStatus.status !== "valid" ? (
            <ForgefileStatusBanner
              projectId={project.id}
              projectName={project.name}
              branch={selectedDeployBranch}
              status={forgefileStatus.status}
              errorMessage={forgefileStatus.errorMessage}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="forge-surface p-4">
              <div className="forge-section-label mb-2">Watch branch</div>
              <div className="font-mono text-lg font-semibold text-[var(--forge-bright)]">
                {project.branch}
              </div>
            </div>
            <div className="forge-surface p-4">
              <div className="forge-section-label mb-2">Deployed</div>
              <div className="font-mono text-lg font-semibold text-[var(--forge-bright)]">
                {shortSha(currentDeployment?.commitSha ?? project.lastSeenCommit)}
              </div>
            </div>
            <div className="forge-surface p-4">
              <div className="forge-section-label mb-2">Last deploy</div>
              <div className="text-lg font-semibold text-[var(--forge-bright)]">
                {deployedAt ? formatRelativeTime(deployedAt) : "Never"}
              </div>
            </div>
            <div className="forge-surface p-4">
              <div className="forge-section-label mb-2">Runtime</div>
              <div
                className={`text-lg font-semibold ${runtimeStatusColor(runtimeStatus)}`}
              >
                {runtimeStatusLabel(runtimeStatus)}
              </div>
            </div>
          </div>

          {blockingAgentSession ? (
            <div className="forge-attention-row justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--forge-bright)]">
                  Agent on{" "}
                  <span className="font-mono">{blockingAgentSession.branch}</span>{" "}
                  is blocking deploys
                </p>
                <p className="text-xs capitalize text-[var(--forge-warning)]">
                  {blockingAgentSession.status}
                </p>
              </div>
              <Button
                size="sm"
                variant="warning"
                onClick={() => openAgentSession(blockingAgentSession.id)}
              >
                Open agent
              </Button>
            </div>
          ) : null}

          {currentDeployment ? (
            <div className="forge-surface p-4">
              <div className="forge-section-label mb-3">Latest deploy</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(currentDeployment.status)}>
                  {currentDeployment.status}
                </Badge>
                <span className="font-mono text-sm text-[var(--forge-bright)]">
                  {shortSha(currentDeployment.commitSha)}
                </span>
                <span className="text-xs text-[var(--forge-muted)]">
                  {formatRelativeTime(currentDeployment.startedAt)}
                </span>
              </div>
            </div>
          ) : null}

          {containers.length > 0 ? (
            <div className="forge-surface p-4">
              <div className="forge-section-label mb-3">Containers</div>
              <ul className="divide-y divide-[var(--forge-line)]">
                {containers.slice(0, 8).map((c) => (
                  <li
                    key={`${c.service}-${c.name}`}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="font-medium text-[var(--forge-bright)]">
                      {c.service}
                    </span>
                    <span
                      className={
                        c.state === "running"
                          ? "forge-status-pill forge-tone-success"
                          : "forge-status-pill forge-tone-neutral"
                      }
                    >
                      {c.state}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <DeployTargetPorts
            projectId={project.id}
            title="Deploy target ports"
          />

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" onClick={() => selectTab("deploy")}>
              Deploy
            </Button>
            <Button variant="info" onClick={() => selectTab("agents")}>
              Agents
            </Button>
            <Button variant="secondary" onClick={() => selectTab("diff")}>
              Changes
            </Button>
            <Button variant="ghost" onClick={() => selectTab("settings")}>
              Settings
            </Button>
          </div>
        </div>
      ) : activeTab === "deploy" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {forgefileStatus && forgefileStatus.status !== "valid" ? (
            <div className="mb-6">
              <ForgefileStatusBanner
                projectId={project.id}
                projectName={project.name}
                branch={selectedDeployBranch}
                status={forgefileStatus.status}
                errorMessage={forgefileStatus.errorMessage}
              />
            </div>
          ) : null}
          {blockingAgentSession && (
            <div className="forge-attention-row mb-6 justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-[var(--forge-bright)]">
                  Deploy is blocked by a{" "}
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${agentSessionSourceBadgeClass(blockingAgentSession.sessionSource)}`}
                  >
                    {agentSessionSourceLabel(blockingAgentSession.sessionSource)}
                  </span>{" "}
                  agent on{" "}
                  <span className="font-mono">
                    {blockingAgentSession.branch}
                  </span>{" "}
                  <span className="capitalize text-[var(--forge-warning)]">
                    ({blockingAgentSession.status})
                  </span>
                  .
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="warning"
                  onClick={() => void endBlockingAgentSession()}
                  disabled={actionLoading || deployBusy}
                >
                  End session
                </Button>
                <Button
                  size="sm"
                  variant="warning"
                  onClick={() => openAgentSession(blockingAgentSession.id)}
                >
                  Open agent
                </Button>
              </div>
            </div>
          )}

          {isForge && (
            <ForgeSelfUpdateEditor
              className="mb-6"
              hideHistory
              hideDeployActions
              hideActiveLogs={Boolean(activeDeployLogs)}
            />
          )}

          <DeployTargetPorts
            className="mb-6"
            projectId={project.id}
            title="Deploy target ports"
          />

          <div className="mb-6 forge-surface-elevated p-4">
            <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <span className="forge-section-label mb-0">
                {isForge ? "Redeploy branch" : "Deploy branch"}
              </span>
              <select
                value={selectedDeployBranch}
                onChange={(e) => setDeployBranch(e.target.value)}
                disabled={actionLoading || deployBusy}
                className="forge-input font-mono text-sm disabled:opacity-50"
              >
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                    {branch === project.branch ? " (watch)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="primary"
              onClick={deployNow}
              disabled={
                actionLoading ||
                deployBusy ||
                Boolean(blockingAgentSession) ||
                deployUpdate?.deployAllowed === false
              }
            >
              {deployPrimaryLabel}
            </Button>
            {updateAvailable && deployUpdate?.remoteCommitSha && (
              <span className="self-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                {shortSha(deployUpdate.deployedCommitSha)} →{" "}
                {shortSha(deployUpdate.remoteCommitSha)}
              </span>
            )}
            {deployUpdate?.remoteCommitLookupFailed && (
              <p className="w-full text-xs text-amber-300/90">
                Could not reach GitHub to compare commits for{" "}
                <span className="font-mono">{selectedDeployBranch}</span>.
              </p>
            )}
            {isForge && selectedDeployBranch !== project.branch && (
              <p className="w-full text-xs text-amber-300/90">
                Redeploying from{" "}
                <span className="font-mono">{selectedDeployBranch}</span> builds
                and releases that branch tip (watch branch is{" "}
                <span className="font-mono">{project.branch}</span>).
              </p>
            )}
            <div className="relative">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setDeployMoreOpen((v) => !v)}
                aria-expanded={deployMoreOpen}
              >
                More
              </Button>
              {deployMoreOpen && (
                <div className="absolute left-0 z-20 mt-1 min-w-[12rem] rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-xl">
                  {!isForge && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeployMoreOpen(false);
                        void toggleEnabled();
                      }}
                      disabled={actionLoading}
                      className="flex w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {project.enabled ? "Pause watching" : "Resume watching"}
                    </button>
                  )}
                  {!isForge && supportsRollback && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeployMoreOpen(false);
                        void rollbackProject();
                      }}
                      disabled={
                        actionLoading || deployBusy || !hasRollbackImage
                      }
                      className="flex w-full rounded-md px-3 py-2 text-left text-sm text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                    >
                      Roll back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDeployMoreOpen(false);
                      void stopProject();
                    }}
                    disabled={actionLoading || deployBusy}
                    className="flex w-full rounded-md px-3 py-2 text-left text-sm text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                  >
                    Stop containers
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:mb-8 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Watch branch" value={project.branch} />
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

          {activeDeployLogs && (
            <ActiveDeployLogsPanel view={activeDeployLogs} />
          )}

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

          <div className="mb-4">
            <button
              type="button"
              onClick={() => setGitTreeOpen((v) => !v)}
              className="forge-surface flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[var(--forge-hover)]"
            >
              <span className="text-sm font-semibold text-[var(--forge-bright)]">
                Git tree
              </span>
              <span className="text-xs text-[var(--forge-muted)]">
                {gitTreeOpen ? "Hide" : "Show"} branch graph
              </span>
            </button>
          </div>
          {gitTreeOpen && (
            <ProjectGitTreePanel
              projectId={id}
              watchBranch={project.branch}
              disabled={actionLoading || deployBusy}
              onRefreshProject={() => void fetchData()}
              onOpenAgentSession={openAgentSession}
            />
          )}
        </div>
      ) : activeTab === "settings" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <section className="mb-8">
            <h2 className="forge-section-label mb-3">Project</h2>
            <div className="forge-surface px-4 py-4">
              <ProjectRenameEditor
                projectId={id}
                name={project.name}
                disabled={actionLoading || deployBusy}
                onRenamed={fetchData}
              />
            </div>
          </section>

          <ProjectLocalBranchesEditor
            projectId={id}
            disabled={actionLoading || deployBusy}
            onChanged={fetchData}
          />

          <div className="mb-8">
            <ProjectRoutingEditor
              key={`${project.updatedAt}-routing`}
              projectId={id}
              values={{
                hostPort: project.hostPort ?? null,
                resolvedHostPort: project.resolvedHostPort ?? null,
                composeProjectName:
                  project.composeProjectName ?? project.name.toLowerCase(),
                caddyRoute: project.caddyRoute ?? null,
                linkedRouteKeys: project.linkedRouteKeys ?? [],
              }}
              disabled={actionLoading || deployBusy}
              saving={routingSaving}
              onSave={saveProjectRouting}
            />
          </div>

          <ProjectCaddyLogsSection
            projectId={id}
            caddyRoute={project.caddyRoute ?? null}
            linkedRouteKeys={project.linkedRouteKeys ?? []}
          />

          <div className="mb-8">
            <DeployEnvVarsEditor
              key={project.updatedAt}
              vars={project.deployEnvVars}
              envFileSource={project.deployEnvFileSource}
              disabled={actionLoading || deployBusy}
              saving={envSaving}
              onSave={saveDeployEnvVars}
            />
          </div>

          <DeploymentHistorySection
            isForge={isForge}
            watchBranch={project.branch}
            deployments={deployments}
            paginatedDeployments={paginatedDeployments}
            expandedDeploymentId={expandedDeploymentId}
            toggleDeployment={toggleDeployment}
            deploymentPageCount={deploymentPageCount}
            safeDeploymentPage={safeDeploymentPage}
            deploymentRangeStart={deploymentRangeStart}
            deploymentRangeEnd={deploymentRangeEnd}
            onPageChange={setDeploymentPage}
          />

          {!isForge && (
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
                Danger zone
              </h2>
              <div className="rounded-xl border border-red-400/20 bg-zinc-900 px-4 py-4">
                <p className="mb-3 text-sm text-zinc-400">
                  Remove this project from {APP_DISPLAY_NAME}. Running containers will not be
                  stopped automatically.
                </p>
                <button
                  onClick={deleteProject}
                  className="min-h-11 rounded-lg border border-red-400/20 px-4 py-2.5 text-sm text-red-400 hover:bg-red-400/10"
                >
                  Remove project
                </button>
              </div>
            </section>
          )}
        </div>
      ) : activeTab === "diff" ? (
        <ProjectDiffPanel projectId={id} watchBranch={project.branch} />
      ) : (
        <AgentWorkspace
          projectId={id}
          watchBranch={project.branch}
          className="min-h-0 flex-1"
          initialSessionId={initialAgentSessionId}
        />
      )}
    </div>
  );
}

function DeploymentHistorySection({
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
  deployments: Deployment[];
  paginatedDeployments: Deployment[];
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
