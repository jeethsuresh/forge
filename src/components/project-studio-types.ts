import type { RuntimeStatus } from "@/lib/project-status";
import type { ProjectCaddySettings } from "@/lib/project-routing-shared";
import type { DeployEnvVarRow } from "@/components/DeployEnvVarsEditor";
import type { ProjectMode } from "@/lib/project-routes";
import type { StudioDeployment } from "@/components/project-studio-panels";

export const DEPLOYMENTS_PER_PAGE = 10;

export function projectPollIntervalMs(
  mode: ProjectMode,
  isDeploying: boolean,
): number | null {
  if (typeof document !== "undefined" && document.hidden) {
    return null;
  }
  if (mode === "agents" || mode === "changes") return 12_000;
  if (mode === "settings" && !isDeploying) return 12_000;
  if (isDeploying) return 5_000;
  return 10_000;
}

export interface ContainerInfo {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
}

export type Deployment = StudioDeployment;

export interface ProjectDetail {
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
    gitSlug?: string | null;
    httpsCloneUrl?: string | null;
    sshCloneUrl?: string | null;
    importedFrom?: string | null;
    gitEmpty?: boolean;
    gitCloneUsername?: string | null;
    gitCloneToken?: string | null;
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
  liveBranches?: Array<{
    name: string;
    sessionId: string | null;
    sessionStatus: string | null;
    containerStatus: "running" | "paused" | "stopped" | null;
  }>;
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

export type ForgefileStatus = {
  status: "missing" | "invalid" | "valid" | "unknown";
  errorMessage: string | null;
};
