import type { AgentDisplayMessage } from "@/lib/agent-stream";
import type { ActiveDeployLogView } from "@/lib/active-deploy-logs";
import { resolveAgentSessionBanner } from "@/lib/agent-turn";
import {
  isInactiveAgentSessionStatus,
  isQueuedAgentSessionStatus,
} from "@/lib/agent-session-source";

export interface AgentSession {
  id: string;
  branch: string;
  status: string;
  initialPrompt: string;
  logs: string;
  errorMessage: string | null;
  failedTurnStartSeq: number | null;
  deploymentId: string | null;
  commitSha: string | null;
  startedAt: string;
  completedAt: string | null;
  archivedAt?: string | null;
  hasActiveRuntime?: boolean;
  hasActiveProcess?: boolean;
  canRetry?: boolean;
  hasFileEdits?: boolean;
  sessionSource?: "manual" | "recovery" | "rebase-recovery";
  sessionSourceLabel?: string;
  containerId?: string | null;
  killReason?: string | null;
}

export type StatusBanner =
  | { kind: "working"; text: string }
  | { kind: "failed"; text: string; canRetry: boolean }
  | null;

export function toStatusBanner(
  banner: ReturnType<typeof resolveAgentSessionBanner>,
): StatusBanner {
  if (!banner) return null;
  if (banner.kind === "failed") {
    return {
      kind: "failed",
      text: banner.text,
      canRetry: banner.canRetry ?? false,
    };
  }
  return { kind: "working", text: banner.text };
}

export interface BranchAgentInfo {
  name: string;
  isDeployBranch: boolean;
  sessionId: string | null;
  sessionStatus: string | null;
  hasAgent: boolean;
}

export interface AgentSessionsResponse {
  sessions: AgentSession[];
  archivedSessions?: AgentSession[];
  branches: BranchAgentInfo[];
  activeSession: AgentSession | null;
  hasActiveSession: boolean;
}

export interface SessionDetailResponse {
  session: AgentSession;
  events: Array<{ seq: number }>;
  messages: AgentDisplayMessage[];
  deployLogView: ActiveDeployLogView | null;
}

export const ACTIVE_AGENT_STATUSES = new Set<string>([
  "pending",
  "running",
  "deploying",
]);

export function sessionForBranch(
  sessions: AgentSession[],
  branch: string,
): AgentSession | undefined {
  return sessions.find((s) => s.branch === branch);
}

export function deriveAgentWorkspaceUi(input: {
  branches: BranchAgentInfo[];
  sessions: AgentSession[];
  selectedBranch: string | null;
  selectedId: string | null;
  sessionDetail: AgentSession | null;
  hasActiveRuntime: boolean;
  showRecreateForm: boolean;
}) {
  const {
    branches,
    sessions,
    selectedBranch,
    selectedId,
    sessionDetail,
    hasActiveRuntime,
    showRecreateForm,
  } = input;
  const selectedBranchInfo = branches.find((b) => b.name === selectedBranch);
  const selectedSessionMeta = selectedBranch
    ? sessionForBranch(sessions, selectedBranch)
    : undefined;
  const deployBranchName =
    branches.find((b) => b.isDeployBranch)?.name ?? null;
  const isArchivedSession = Boolean(sessionDetail?.archivedAt);
  const isActiveSession = Boolean(
    sessionDetail &&
      !isArchivedSession &&
      ACTIVE_AGENT_STATUSES.has(sessionDetail.status),
  );
  const isQueuedSession = Boolean(
    sessionDetail &&
      !isArchivedSession &&
      isQueuedAgentSessionStatus(sessionDetail.status),
  );
  const showEndSession = Boolean(
    (isActiveSession || isQueuedSession) && selectedId && !isArchivedSession,
  );
  const isDeploying =
    !isArchivedSession && sessionDetail?.status === "deploying";
  const isRecoverySession = sessionDetail?.sessionSource === "recovery";
  const isRebaseRecoverySession =
    sessionDetail?.sessionSource === "rebase-recovery";
  const canStartOnBranch = Boolean(
    selectedBranch &&
      !isArchivedSession &&
      !isActiveSession &&
      !isQueuedSession &&
      (!selectedBranchInfo?.hasAgent ||
        (selectedBranchInfo.sessionStatus &&
          isInactiveAgentSessionStatus(selectedBranchInfo.sessionStatus))),
  );
  const isTerminalSession = Boolean(
    sessionDetail &&
      !isArchivedSession &&
      isInactiveAgentSessionStatus(sessionDetail.status),
  );
  const showFollowUp = Boolean(
    isActiveSession && !isDeploying && selectedId && !isArchivedSession,
  );
  const canCommitOrDeploy = Boolean(
    sessionDetail &&
      !isArchivedSession &&
      ["running", "completed", "failed"].includes(sessionDetail.status) &&
      !hasActiveRuntime &&
      !isDeploying,
  );
  const showActiveAgentActions =
    canCommitOrDeploy && sessionDetail?.status === "running";
  const showFinishedAgentActions =
    canCommitOrDeploy && sessionDetail?.status === "completed";
  const showRevertCommit = Boolean(
    showFinishedAgentActions && sessionDetail?.commitSha && !sessionDetail.deploymentId,
  );
  const showFailedAgentActions =
    canCommitOrDeploy && sessionDetail?.status === "failed";
  const showFinishAndDeploy = Boolean(
    canCommitOrDeploy &&
      sessionDetail &&
      sessionDetail.hasFileEdits !== false &&
      !sessionDetail.deploymentId,
  );
  const showContinueForm = Boolean(canStartOnBranch && isTerminalSession);
  const showNewAgentForm = Boolean(canStartOnBranch && !selectedId);
  const showRecreateButton = Boolean(
    selectedBranch &&
      selectedSessionMeta &&
      !isArchivedSession &&
      !showRecreateForm,
  );
  const showArchiveButton = Boolean(
    selectedId &&
      selectedSessionMeta &&
      !isArchivedSession &&
      !showRecreateForm,
  );
  const showRestartButton = Boolean(
    selectedSessionMeta && !isArchivedSession && !showRecreateForm,
  );
  const agentBranches = branches.filter((b) => b.hasAgent);
  const idleBranches = branches.filter((b) => !b.hasAgent);

  return {
    selectedBranchInfo,
    selectedSessionMeta,
    deployBranchName,
    isArchivedSession,
    isActiveSession,
    isQueuedSession,
    showEndSession,
    isDeploying,
    isRecoverySession,
    isRebaseRecoverySession,
    canStartOnBranch,
    isTerminalSession,
    showFollowUp,
    canCommitOrDeploy,
    showActiveAgentActions,
    showFinishedAgentActions,
    showRevertCommit,
    showFailedAgentActions,
    showFinishAndDeploy,
    showContinueForm,
    showNewAgentForm,
    showRecreateButton,
    showArchiveButton,
    showRestartButton,
    agentBranches,
    idleBranches,
  };
}
