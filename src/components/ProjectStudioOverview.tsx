"use client";

import {
  formatRelativeTime,
  runtimeStatusColor,
  runtimeStatusLabel,
  shortSha,
} from "@/lib/utils";
import type { RuntimeStatus } from "@/lib/project-status";
import { ForgefileStatusBanner } from "@/components/ForgefileStatusBanner";
import { DeployTargetPorts } from "@/components/DeployTargetPorts";
import { ProjectArtifacts } from "@/components/ProjectArtifacts";
import { statusTone } from "@/lib/ui-status";
import { Badge, Button } from "@/components/ui";
import type { ProjectMode } from "@/lib/project-routes";
import type {
  ContainerInfo,
  Deployment,
  ForgefileStatus,
  ProjectDetail,
} from "@/components/project-studio-types";

export function ProjectStudioOverview({
  project,
  forgefileStatus,
  selectedDeployBranch,
  currentDeployment,
  deployedAt,
  runtimeStatus,
  blockingAgentSession,
  liveBranches,
  containers,
  openAgentSession,
  openChanges,
  selectTab,
}: {
  project: ProjectDetail["project"];
  forgefileStatus: ForgefileStatus | null;
  selectedDeployBranch: string;
  currentDeployment: Deployment | null;
  deployedAt: string | null | undefined;
  runtimeStatus: RuntimeStatus;
  blockingAgentSession: ProjectDetail["blockingAgentSession"];
  liveBranches: NonNullable<ProjectDetail["liveBranches"]>;
  containers: ContainerInfo[];
  openAgentSession: (sessionId: string) => void;
  openChanges: (branch: string) => void;
  selectTab: (tab: ProjectMode) => void;
}) {
  return (
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

      {liveBranches.length > 0 ? (
        <div className="forge-surface p-4">
          <div className="forge-section-label mb-3">Live branches</div>
          <ul className="divide-y divide-[var(--forge-line)]">
            {liveBranches.map((branch) => (
              <li key={branch.name} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-[var(--forge-bright)]">{branch.name}</p>
                  <p className="text-xs text-[var(--forge-muted)]">
                    {branch.sessionStatus ? `agent ${branch.sessionStatus}` : "checkout only"}
                    {branch.containerStatus ? ` · container ${branch.containerStatus}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (branch.sessionId) {
                      openAgentSession(branch.sessionId);
                      return;
                    }
                    openChanges(branch.name);
                  }}
                >
                  {branch.sessionId ? "Open agent" : "Open changes"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : blockingAgentSession ? (
        <div className="forge-attention-row justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--forge-bright)]">
              Agent on{" "}
              <span className="font-mono">{blockingAgentSession.branch}</span>{" "}
              is running
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

      <ProjectArtifacts projectId={project.id} className="mt-6" />

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary" onClick={() => selectTab("deploy")}>
          Deploy
        </Button>
        <Button variant="info" onClick={() => selectTab("agents")}>
          Agents
        </Button>
        <Button variant="secondary" onClick={() => selectTab("changes")}>
          Changes
        </Button>
        <Button variant="ghost" onClick={() => selectTab("settings")}>
          Settings
        </Button>
      </div>
    </div>
  );
}
