"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { ProjectRenameEditor } from "@/components/ProjectRenameEditor";
import { GitLocalPushRecipes } from "@/components/GitLocalPushRecipes";
import { GitHttpsCredentials } from "@/components/GitHttpsCredentials";
import { ProjectRoutingEditor } from "@/components/ProjectRoutingEditor";
import type { ProjectCaddySettings } from "@/lib/project-routing-shared";
import {
  DeployEnvVarsEditor,
  type DeployEnvVarRow,
} from "@/components/DeployEnvVarsEditor";
import { ProjectCaddyLogsSection } from "@/components/ProjectCaddyLogsSection";
import { ProjectLocalBranchesEditor } from "@/components/ProjectLocalBranchesEditor";
import {
  DeploymentHistorySection,
  type StudioDeployment,
} from "@/components/project-studio-panels";

export function ProjectStudioSettings({
  projectId,
  project,
  isForge,
  actionLoading,
  deployBusy,
  fetchData,
  regeneratingCloneToken,
  regenerateCloneToken,
  routingSaving,
  saveProjectRouting,
  envSaving,
  saveDeployEnvVars,
  deployments,
  paginatedDeployments,
  expandedDeploymentId,
  toggleDeployment,
  deploymentPageCount,
  safeDeploymentPage,
  deploymentRangeStart,
  deploymentRangeEnd,
  setDeploymentPage,
  deleteProject,
}: {
  projectId: string;
  project: {
    name: string;
    branch: string;
    githubRepo: string;
    updatedAt: string;
    hostPort?: number | null;
    resolvedHostPort?: number | null;
    composeProjectName?: string;
    caddyRoute?: ProjectCaddySettings | null;
    linkedRouteKeys?: string[];
    httpsCloneUrl?: string | null;
    sshCloneUrl?: string | null;
    gitEmpty?: boolean;
    gitCloneToken?: string | null;
    deployEnvVars: DeployEnvVarRow[];
    deployEnvFileSource: ".env" | ".env.example" | null;
  };
  isForge: boolean;
  actionLoading: boolean;
  deployBusy: boolean;
  fetchData: () => Promise<void>;
  regeneratingCloneToken: boolean;
  regenerateCloneToken: () => void | Promise<void>;
  routingSaving: boolean;
  saveProjectRouting: (payload: {
    hostPort: number | null;
    caddyRoute: ProjectCaddySettings | null;
    linkedRouteKeys: string[];
  }) => Promise<boolean>;
  envSaving: boolean;
  saveDeployEnvVars: (vars: DeployEnvVarRow[]) => Promise<boolean>;
  deployments: StudioDeployment[];
  paginatedDeployments: StudioDeployment[];
  expandedDeploymentId: string | null;
  toggleDeployment: (id: string) => void;
  deploymentPageCount: number;
  safeDeploymentPage: number;
  deploymentRangeStart: number;
  deploymentRangeEnd: number;
  setDeploymentPage: Dispatch<SetStateAction<number>>;
  deleteProject: () => void | Promise<void>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <section className="mb-8">
        <h2 className="forge-section-label mb-3">Project</h2>
        <div className="forge-surface px-4 py-4">
          <ProjectRenameEditor
            projectId={projectId}
            name={project.name}
            disabled={actionLoading || deployBusy}
            onRenamed={fetchData}
          />
        </div>
      </section>

      {project.httpsCloneUrl || project.sshCloneUrl ? (
        <section className="mb-8">
          <h2 className="forge-section-label mb-3">Clone URLs</h2>
          <div className="forge-surface space-y-3 px-4 py-4">
            {project.gitEmpty && project.httpsCloneUrl ? (
              <>
                <p className="text-sm text-[var(--forge-muted)]">
                  This Forge repo has no commits yet. Push from your local
                  checkout:
                </p>
                <GitLocalPushRecipes
                  httpsUrl={project.httpsCloneUrl}
                  sshUrl={project.sshCloneUrl}
                  defaultBranch={project.branch}
                  cloneToken={project.gitCloneToken}
                  regenerating={regeneratingCloneToken}
                  onRegenerate={regenerateCloneToken}
                />
              </>
            ) : (
              <>
                {project.httpsCloneUrl ? (
                  <div>
                    <div className="text-xs font-medium text-[var(--forge-muted)]">
                      HTTPS (smart HTTP)
                    </div>
                    <code className="mt-1 block break-all font-mono text-xs text-[var(--forge-bright)]">
                      {project.httpsCloneUrl}
                    </code>
                  </div>
                ) : null}
                <GitHttpsCredentials
                  cloneToken={project.gitCloneToken}
                  regenerating={regeneratingCloneToken}
                  onRegenerate={regenerateCloneToken}
                />
                {project.sshCloneUrl ? (
                  <div>
                    <div className="text-xs font-medium text-[var(--forge-muted)]">
                      SSH
                    </div>
                    <code className="mt-1 block break-all font-mono text-xs text-[var(--forge-bright)]">
                      {project.sshCloneUrl}
                    </code>
                    <p className="mt-1 text-xs text-[var(--forge-faint)]">
                      Register keys under Global settings → Git SSH.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="mb-8">
          <h2 className="forge-section-label mb-3">Git origin</h2>
          <div className="forge-surface px-4 py-4 text-sm text-[var(--forge-muted)]">
            This project still uses GitHub (
            <code className="text-xs">{project.githubRepo}</code>
            ). Import into Forge from{" "}
            <Link
              href="/projects/new"
              className="text-[var(--forge-accent-hot)]"
            >
              Add project → Import GitHub
            </Link>{" "}
            or attach an existing checkout via{" "}
            <Link
              href="/projects/new"
              className="text-[var(--forge-accent-hot)]"
            >
              Add local
            </Link>{" "}
            to make Forge the primary origin.
          </div>
        </section>
      )}

      <ProjectLocalBranchesEditor
        projectId={projectId}
        disabled={actionLoading || deployBusy}
        onChanged={fetchData}
      />

      <div className="mb-8">
        <ProjectRoutingEditor
          key={`${project.updatedAt}-routing`}
          projectId={projectId}
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
        projectId={projectId}
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
  );
}
