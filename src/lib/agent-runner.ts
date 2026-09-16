import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { and, desc, eq, gt, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentEvents,
  agentSessions,
  deployments,
  forgeUpdates,
  projects,
  type AgentSessionStatus,
  type Project,
} from "@/lib/db/schema";
import { sessionEventsHaveFileEdits } from "@/lib/agent-stream";
import {
  canRetryFailedAgentTurn,
  failedTurnEventSeq,
  isAgentTurnComplete,
  isStuckActiveSession,
} from "@/lib/agent-turn";
import {
  activeAgentProjects,
  applyAgentDeploymentOutcome,
  getActiveSessionForProject,
  isAgentSessionActive,
} from "@/lib/agent-state";
import {
  agentSessionSourceLabel,
  resolveAgentSessionSource,
  shouldAutoCompleteRecoverySession,
} from "@/lib/agent-session-source";
import {
  listLocalBranches,
  prepareAgentWorkspace,
  hasUncommittedChanges,
} from "@/lib/git-workspace";
import { gitHubCredentials } from "@/lib/github-import";
import {
  projectAgentCloneUrl,
  projectRemoteUrl,
  projectUsesForgeGit,
} from "@/lib/project-git-remote";
import { deployProject } from "@/lib/project-deploy";
import { resolveClonePath } from "@/lib/paths";
import { prependForgeOpsInstructions, buildForgeOpsAgentInstructions } from "@/lib/agent-ops-prompt";
import { isForgeUpdateTerminalStatus } from "@/lib/ops-session-deploy";
import { mintSessionOpsToken, opsApiBaseUrl } from "@/lib/ops-api-auth";
import {
  isProjectAgentPipelineBusy,
  markAgentSessionQueued,
  processAgentQueue,
} from "@/lib/agent-queue";
import {
  removeAgentContainer,
  startAgentContainer,
  stopAgentContainer,
  waitForAgentContainerExit,
  getAgentContainer,
} from "@/lib/agent-container";
import { AGENT_HEARTBEAT_INTERVAL_SEC } from "@/lib/agent-heartbeat";
import { getProjectForgefile } from "@/lib/forgefile-project";
import type { Forgefile } from "@/lib/forgefile-types";
import { transition, type SessionPatch } from "@/lib/agent-session-machine";
import { commitAgentSessionChanges } from "@/lib/agent-session-lifecycle";

/** Sessions with a live agent container. */
export const activeAgentContainers = new Set<string>();
export const stoppingSessions = new Set<string>();
export const cancelledSessions = new Set<string>();
/** Session ended via endAgentSession — container close must not overwrite status. */
export const endedSessions = new Set<string>();
const deploymentPollTimers = new Map<string, NodeJS.Timeout>();
const deploymentPollActive = new Set<string>();

export function agentRuntimeMode(): "container" {
  return "container";
}

export function isAgentRuntimeActive(sessionId: string): boolean {
  return activeAgentContainers.has(sessionId);
}

export async function stopAgentRuntime(sessionId: string): Promise<void> {
  if (!activeAgentContainers.has(sessionId)) return;
  try {
    await stopAgentContainer(sessionId);
  } catch {
    // ignore stop failures
  }
  try {
    await removeAgentContainer(sessionId);
  } catch {
    // ignore remove failures
  }
  activeAgentContainers.delete(sessionId);
}

export const TERMINAL_STATUSES: AgentSessionStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export const ACTIVE_TURN_STATUSES: AgentSessionStatus[] = [
  "pending",
  "running",
  "deploying",
];

export function drainAgentQueue(projectId: string): void {
  processAgentQueue(projectId, (sessionId, queuedProjectId, prompt) => {
    void executeAgentTurn(sessionId, queuedProjectId, prompt);
  });
}

export function drainQueuedAgentSessions(projectId: string): void {
  drainAgentQueue(projectId);
}

export function cancelDeploymentPoll(sessionId: string): void {
  deploymentPollActive.delete(sessionId);
  const timer = deploymentPollTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    deploymentPollTimers.delete(sessionId);
  }
}

export function appendSessionLog(sessionId: string, message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  const row = db
    .select({ logs: agentSessions.logs })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  const logs = (row?.logs ?? "") + line;
  db.update(agentSessions)
    .set({ logs })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export function updateSessionStatus(
  sessionId: string,
  status: AgentSessionStatus,
  extra?: SessionPatch,
): void {
  switch (status) {
    case "queued":
      transition(sessionId, { type: "queue" }, extra);
      return;
    case "pending":
      transition(sessionId, { type: "start" }, extra);
      return;
    case "running":
      transition(sessionId, { type: "run" }, extra);
      return;
    case "deploying":
      transition(
        sessionId,
        { type: "deploy_start", deploymentId: extra?.deploymentId ?? undefined },
        extra,
      );
      return;
    case "completed":
      transition(sessionId, { type: "turn_complete" }, extra);
      return;
    case "failed":
      transition(
        sessionId,
        { type: "fail", errorMessage: extra?.errorMessage ?? "failed" },
        extra,
      );
      return;
    case "cancelled":
      transition(sessionId, { type: "operator_stop", reason: "cancel" }, extra);
      return;
    case "idle":
      patchIdleNotSupported(sessionId, extra);
      return;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function patchIdleNotSupported(sessionId: string, extra?: SessionPatch): void {
  if (extra) {
    db.update(agentSessions).set(extra).where(eq(agentSessions.id, sessionId)).run();
  }
}

export function getNextEventSeq(sessionId: string): number {
  const row = db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
    .get();
  return (row?.seq ?? 0) + 1;
}

export function recordEvent(sessionId: string, eventType: string, payload: string): void {
  const seq = getNextEventSeq(sessionId);
  db.insert(agentEvents)
    .values({
      id: randomUUID(),
      sessionId,
      seq,
      eventType,
      payload,
      createdAt: new Date(),
    })
    .run();
}

export interface BranchAgentInfo {
  name: string;
  isDeployBranch: boolean;
  sessionId: string | null;
  sessionStatus: AgentSessionStatus | null;
  hasAgent: boolean;
}

export function markTurnSucceeded(sessionId: string): void {
  const current = db
    .select({ cursorSessionId: agentSessions.cursorSessionId })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  db.update(agentSessions)
    .set({
      resumeCursorSessionId: current?.cursorSessionId ?? null,
      failedTurnStartSeq: null,
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export function markTurnFailed(sessionId: string, turnStartSeq: number): void {
  db.update(agentSessions)
    .set({ failedTurnStartSeq: turnStartSeq })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export function deleteEventsFromSeq(sessionId: string, fromSeq: number): void {
  db.delete(agentEvents)
    .where(and(eq(agentEvents.sessionId, sessionId), gte(agentEvents.seq, fromSeq)))
    .run();
}

export function reactivateSession(sessionId: string): void {
  db.update(agentSessions)
    .set({
      status: "idle",
      errorMessage: null,
      completedAt: null,
      deploymentId: null,
      commitSha: null,
      failedTurnStartSeq: null,
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export function reactivateFailedSession(sessionId: string): void {
  db.update(agentSessions)
    .set({
      status: "pending",
      errorMessage: null,
      completedAt: null,
      failedTurnStartSeq: null,
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export function isAgentProcessRunning(sessionId: string): boolean {
  return isAgentRuntimeActive(sessionId);
}

export type AgentSessionForClient = NonNullable<ReturnType<typeof getAgentSession>> & {
  hasActiveRuntime: boolean;
  /** @deprecated Use hasActiveRuntime */
  hasActiveProcess: boolean;
  canRetry: boolean;
  hasFileEdits: boolean;
  sessionSource: ReturnType<typeof resolveAgentSessionSource>;
  sessionSourceLabel: string;
  containerId: string | null;
  killReason: string | null;
};

function withClientFields(session: NonNullable<ReturnType<typeof getAgentSession>>): AgentSessionForClient {
  const events = getAllAgentEventsAfter(session.id, 0);
  const sessionSource = resolveAgentSessionSource(session);
  const container = getAgentContainer(session.id);
  return {
    ...session,
    hasActiveRuntime: isAgentProcessRunning(session.id),
    hasActiveProcess: isAgentProcessRunning(session.id),
    canRetry: canRetryFailedAgentTurn(session, events),
    hasFileEdits: sessionEventsHaveFileEdits(events),
    sessionSource,
    sessionSourceLabel: agentSessionSourceLabel(sessionSource),
    containerId: container?.containerId ?? null,
    killReason: container?.killReason ?? null,
  };
}

async function maybeAutoFinishSessionIfNoEdits(
  sessionId: string,
  projectId: string,
): Promise<void> {
  const session = getAgentSession(sessionId);
  if (!session || session.status !== "running") return;

  const events = getAllAgentEventsAfter(sessionId, 0);
  if (sessionEventsHaveFileEdits(events)) return;

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return;

  const log = (msg: string) => appendSessionLog(sessionId, msg);

  try {
    await prepareAgentWorkspace(
      projectRemoteUrl(project),
      project.branch,
      project.clonePath,
      session.branch,
      log,
    );
  } catch {
    return;
  }

  if (await hasUncommittedChanges(project.clonePath)) return;

  log("No file edits in this session. Marking as finished.");
  updateSessionStatus(sessionId, "completed", { completedAt: new Date() });
  activeAgentProjects.delete(projectId);
}

export function finalizeSessionAfterFailedTurn(
  sessionId: string,
  projectId: string,
  message: string,
): void {
  const session = getAgentSession(sessionId);
  if (!session || TERMINAL_STATUSES.includes(session.status)) return;

  const log = (msg: string) => appendSessionLog(sessionId, msg);
  const isRecovery = shouldAutoCompleteRecoverySession(session);

  if (isRecovery) {
    log(`Recovery agent finished with errors: ${message}`);
    log(
      "Uncommitted changes were left in the workspace. Commit them manually, or end the session with revertChanges before starting another agent.",
    );
  } else {
    log(`ERROR: ${message}`);
  }

  if (session.failedTurnStartSeq == null) {
    const events = getAllAgentEventsAfter(sessionId, 0);
    const boundary = failedTurnEventSeq(events, null);
    if (boundary != null) {
      markTurnFailed(sessionId, boundary);
    }
  }

  updateSessionStatus(sessionId, "failed", {
    errorMessage: message,
    completedAt: new Date(),
  });
  activeAgentProjects.delete(projectId);
  drainAgentQueue(projectId);
}

export async function finalizeSessionAfterSuccessfulTurn(
  sessionId: string,
  projectId: string,
): Promise<void> {
  const afterTurn = getAgentSession(sessionId);
  if (!afterTurn || TERMINAL_STATUSES.includes(afterTurn.status)) return;

  await maybeAutoFinishSessionIfNoEdits(sessionId, projectId);
  const refreshed = getAgentSession(sessionId);
  if (!refreshed || TERMINAL_STATUSES.includes(refreshed.status)) {
    drainAgentQueue(projectId);
    return;
  }

  const isRecovery = shouldAutoCompleteRecoverySession(refreshed);
  const log = (msg: string) => appendSessionLog(sessionId, msg);
  try {
    await commitAgentSessionChanges(sessionId);
    updateSessionStatus(sessionId, "completed", {
      completedAt: new Date(),
      errorMessage: null,
    });
    log(
      isRecovery
        ? "Recovery agent finished. Changes committed and pushed."
        : "Agent turn finished. Changes committed and pushed.",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR committing changes: ${message}`);
    if (isRecovery) {
      log(
        "Recovery agent ended without committing. Review uncommitted changes in the workspace, or end the session with revertChanges before starting another agent.",
      );
    }
    updateSessionStatus(sessionId, "failed", {
      errorMessage: message,
      completedAt: new Date(),
    });
  }
  activeAgentProjects.delete(projectId);
  drainAgentQueue(projectId);
}

export function reconcileStuckAgentSession(sessionId: string) {
  const session = getAgentSession(sessionId);
  if (!session) return undefined;

  const events = getAllAgentEventsAfter(sessionId, 0);
  const turnIncomplete =
    session.status === "running" && !isAgentTurnComplete(events);

  const stuck = isStuckActiveSession({
    status: session.status,
    failedTurnStartSeq: session.failedTurnStartSeq,
    hasActiveRuntime: isAgentRuntimeActive(sessionId),
    projectMarkedActive: activeAgentProjects.has(session.projectId),
    turnIncomplete,
  });

  if (!stuck) return session;

  const message =
    session.status === "pending"
      ? "Agent session did not start (server may have restarted)"
      : "Agent process ended unexpectedly";

  appendSessionLog(sessionId, `ERROR: ${message}`);

  let failedTurnStartSeq = session.failedTurnStartSeq;
  if (failedTurnStartSeq == null) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.eventType === "user") {
        failedTurnStartSeq = events[i]!.seq;
        break;
      }
    }
  }

  db.update(agentSessions)
    .set({
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      failedTurnStartSeq,
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
  activeAgentProjects.delete(session.projectId);
  return getAgentSession(sessionId);
}

export function getAgentSessionForClient(sessionId: string): AgentSessionForClient | undefined {
  const session = reconcileStuckAgentSession(sessionId);
  if (!session) return undefined;
  return withClientFields(session);
}

export function getSessionForBranch(projectId: string, branch: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.branch, branch),
        isNull(agentSessions.archivedAt),
      ),
    )
    .get();
}

export async function getBranchAgentOverview(
  projectId: string,
): Promise<BranchAgentInfo[]> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) return [];

  const localBranches = await listLocalBranches(project.clonePath);
  const sessions = listAgentSessionsForClient(projectId);
  const sessionByBranch = new Map(sessions.map((s) => [s.branch, s]));

  const branchNames = new Set(localBranches);
  for (const session of sessions) {
    branchNames.add(session.branch);
  }

  return [...branchNames].sort((a, b) => a.localeCompare(b)).map((name) => {
    const session = sessionByBranch.get(name);
    return {
      name,
      isDeployBranch: name === project.branch,
      sessionId: session?.id ?? null,
      sessionStatus: session?.status ?? null,
      hasAgent: Boolean(session),
    };
  });
}

export function assertNoConflictingActiveSession(
  projectId: string,
  branch: string,
): void {
  if (!isAgentSessionActive(projectId)) return;

  const active = getActiveSessionForProject(projectId);
  if (active && active.branch !== branch) {
    throw new Error(
      `An agent is active on branch "${active.branch}". Queue another branch or wait for it to finish.`,
    );
  }
}

export function shouldQueueAgentSession(projectId: string, branch: string): boolean {
  if (!isProjectAgentPipelineBusy(projectId)) return false;
  const active = getActiveSessionForProject(projectId);
  return Boolean(active && active.branch !== branch);
}

export function queueAgentSession(
  projectId: string,
  branch: string,
  prompt: string,
): { sessionId: string; queued: true } {
  const trimmedPrompt = prompt.trim();
  const existing = getSessionForBranch(projectId, branch);

  if (existing) {
    if (existing.status === "queued") {
      markAgentSessionQueued(existing.id, trimmedPrompt);
      appendSessionLog(existing.id, "Queued agent prompt updated.");
      return { sessionId: existing.id, queued: true };
    }
    if (ACTIVE_TURN_STATUSES.includes(existing.status)) {
      throw new Error(
        `An agent is already active on branch "${branch}".`,
      );
    }
    markAgentSessionQueued(existing.id, trimmedPrompt);
    appendSessionLog(
      existing.id,
      `Queued behind the active agent on another branch.`,
    );
    return { sessionId: existing.id, queued: true };
  }

  const sessionId = randomUUID();
  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId,
      branch,
      status: "queued",
      source: "manual",
      initialPrompt: trimmedPrompt,
      logs: `[${new Date().toISOString()}] Queued behind the active agent on another branch.\n`,
      startedAt: new Date(),
    })
    .run();

  return { sessionId, queued: true };
}

function resolveAgentPackagesJson(projectId: string): string | undefined {
  const row = getProjectForgefile(projectId);
  if (!row || row.status !== "valid") return undefined;
  try {
    const parsed = JSON.parse(row.parsedJson) as Forgefile;
    const packages = parsed.agent?.packages;
    if (!Array.isArray(packages) || packages.length === 0) return undefined;
    return JSON.stringify(packages);
  } catch {
    return undefined;
  }
}

export async function runAgentTurnContainer(
  sessionId: string,
  project: Project,
  prompt: string,
  effectivePrompt: string,
  turnStartSeq: number,
  workspacePath?: string,
): Promise<void> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  if (!session) throw new Error("Session not found");

  const workspace = resolveClonePath(workspacePath ?? project.clonePath);
  const creds = gitHubCredentials();
  const apiKey = process.env.FORGE_CURSOR_API_KEY ?? process.env.CURSOR_API_KEY;

  activeAgentContainers.add(sessionId);
  appendSessionLog(sessionId, "Starting agent container (no docker.sock)…");

  try {
    const { containerId } = await startAgentContainer({
      sessionId,
      projectId: project.id,
      branch: session.branch,
      cloneUrl: projectAgentCloneUrl(project),
      opsBaseUrl: opsApiBaseUrl(),
      opsToken: mintSessionOpsToken(sessionId, project.id),
      gitUsername: projectUsesForgeGit(project) ? "forge" : creds?.username,
      gitPassword: projectUsesForgeGit(project)
        ? mintSessionOpsToken(sessionId, project.id)
        : creds?.password,
      heartbeatIntervalSec: AGENT_HEARTBEAT_INTERVAL_SEC,
      agentPrompt: effectivePrompt,
      cursorApiKey: apiKey,
      packagesJson: resolveAgentPackagesJson(project.id),
      workspaceBind: existsSync(workspace) ? workspace : undefined,
      cursorSessionId:
        session.resumeCursorSessionId ?? session.cursorSessionId ?? undefined,
    });

    appendSessionLog(
      sessionId,
      `Agent container ${containerId.slice(0, 12)} started; events via Ops ingest.`,
    );

    const code = await waitForAgentContainerExit(sessionId);

    if (cancelledSessions.has(sessionId)) {
      cancelledSessions.delete(sessionId);
      return;
    }

    if (endedSessions.has(sessionId)) {
      endedSessions.delete(sessionId);
      stoppingSessions.delete(sessionId);
      return;
    }

    if (stoppingSessions.has(sessionId)) {
      stoppingSessions.delete(sessionId);
      markTurnFailed(sessionId, turnStartSeq);
      transition(sessionId, { type: "operator_stop", reason: "stop" });
      appendSessionLog(sessionId, "Agent stopped by user.");
      activeAgentProjects.delete(project.id);
      drainAgentQueue(project.id);
      return;
    }

    if (code !== 0) {
      markTurnFailed(sessionId, turnStartSeq);
      throw new Error(`Agent container exited with code ${code}`);
    }
    markTurnSucceeded(sessionId);
  } finally {
    activeAgentContainers.delete(sessionId);
    try {
      await removeAgentContainer(sessionId);
    } catch {
      // already removed
    }
  }
}

export async function runAgentTurn(
  sessionId: string,
  project: Project,
  prompt: string,
  workspacePath?: string,
): Promise<void> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");

  updateSessionStatus(sessionId, "running");
  const includeOpsInstructions = !session.resumeCursorSessionId && !session.cursorSessionId;
  const opsInstructions = includeOpsInstructions
    ? buildForgeOpsAgentInstructions(project.id, sessionId)
    : null;
  const effectivePrompt = opsInstructions
    ? prependForgeOpsInstructions(prompt, project.id, sessionId, true)
    : prompt;

  appendSessionLog(
    sessionId,
    `Starting agent turn: ${prompt.slice(0, 80)}…`,
  );

  const turnStartSeq = getNextEventSeq(sessionId);
  if (opsInstructions) {
    recordEvent(
      sessionId,
      "system",
      JSON.stringify({
        type: "system",
        subtype: "forge-ops",
        text: opsInstructions,
      }),
    );
  }
  recordEvent(sessionId, "user", JSON.stringify({ type: "user", text: prompt }));

  await runAgentTurnContainer(
    sessionId,
    project,
    prompt,
    effectivePrompt,
    turnStartSeq,
    workspacePath,
  );
}

export async function deployAfterAgent(
  sessionId: string,
  projectId: string,
  branch: string,
): Promise<void> {
  updateSessionStatus(sessionId, "deploying");
  appendSessionLog(sessionId, "Agent finished. Starting rebuild and release…");

  try {
    const result = await deployProject({
      projectId,
      branch,
      trigger: "agent",
    });
    db.update(agentSessions)
      .set({ deploymentId: result.deploymentId })
      .where(eq(agentSessions.id, sessionId))
      .run();
    const started =
      result.mode === "forge-self-update"
        ? `Forge self-update ${result.deploymentId} started (not ./deploy.sh).`
        : `Deployment ${result.deploymentId} started.`;
    appendSessionLog(sessionId, started);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendSessionLog(sessionId, `Deployment failed: ${message}`);
    updateSessionStatus(sessionId, "failed", {
      errorMessage: message,
      completedAt: new Date(),
    });
    activeAgentProjects.delete(projectId);
    throw err;
  }
}

export async function waitForDeploymentAndFinalize(
  sessionId: string,
  projectId: string,
): Promise<void> {
  cancelDeploymentPoll(sessionId);

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session?.deploymentId) {
    updateSessionStatus(sessionId, "completed", { completedAt: new Date() });
    activeAgentProjects.delete(projectId);
    return;
  }

  deploymentPollActive.add(sessionId);

  const poll = (): void => {
    if (!deploymentPollActive.has(sessionId)) return;

    const current = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();

    if (!current?.deploymentId) {
      cancelDeploymentPoll(sessionId);
      return;
    }

    const forgeUpdate = db
      .select()
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, current.deploymentId))
      .get();

    if (forgeUpdate) {
      if (
        !forgeUpdate.completedAt ||
        !isForgeUpdateTerminalStatus(forgeUpdate.status)
      ) {
        deploymentPollTimers.set(sessionId, setTimeout(poll, 2000));
        return;
      }
      cancelDeploymentPoll(sessionId);
      applyAgentDeploymentOutcome(sessionId, forgeUpdate.id);
      return;
    }

    const dep = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, current.deploymentId))
      .get();

    if (!dep || !dep.completedAt) {
      deploymentPollTimers.set(sessionId, setTimeout(poll, 2000));
      return;
    }

    cancelDeploymentPoll(sessionId);
    // Only finalize if this session is still waiting on this deployment.
    // Recovery (or End session) may have already moved it out of deploying.
    applyAgentDeploymentOutcome(sessionId, dep.id);
  };

  deploymentPollTimers.set(sessionId, setTimeout(poll, 2000));
}

export async function executeAgentTurn(
  sessionId: string,
  projectId: string,
  prompt: string,
  options?: { workspacePath?: string },
): Promise<void> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) {
    updateSessionStatus(sessionId, "failed", {
      errorMessage: "Project not found",
      completedAt: new Date(),
    });
    activeAgentProjects.delete(projectId);
    drainAgentQueue(projectId);
    return;
  }

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) return;

  const log = (msg: string) => appendSessionLog(sessionId, msg);

  try {
    await prepareAgentWorkspace(
      projectRemoteUrl(project),
      project.branch,
      options?.workspacePath ?? project.clonePath,
      session.branch,
      log,
    );

    await runAgentTurn(sessionId, project, prompt, options?.workspacePath);
    await finalizeSessionAfterSuccessfulTurn(sessionId, projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finalizeSessionAfterFailedTurn(sessionId, projectId, message);
  }
}

export function listAgentSessions(projectId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        isNull(agentSessions.archivedAt),
      ),
    )
    .orderBy(desc(agentSessions.startedAt))
    .all();
}

export function listArchivedAgentSessions(projectId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        isNotNull(agentSessions.archivedAt),
      ),
    )
    .orderBy(desc(agentSessions.archivedAt))
    .all();
}

export function listAgentSessionsForClient(projectId: string) {
  return listAgentSessions(projectId).map((session) => {
    const reconciled = reconcileStuckAgentSession(session.id) ?? session;
    return withClientFields(reconciled);
  });
}

export function listArchivedAgentSessionsForClient(projectId: string) {
  return listArchivedAgentSessions(projectId).map((session) =>
    withClientFields(session),
  );
}

export function getAgentSession(sessionId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
}

export function getAllAgentEventsAfter(sessionId: string, afterSeq: number) {
  return db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.sessionId, sessionId), gt(agentEvents.seq, afterSeq)))
    .orderBy(agentEvents.seq)
    .all();
}

export {
  createAgentBranch,
  createAgentSession,
  waitForAgentSessionTerminal,
  createRecoveryAgentSession,
  createRebaseRecoveryAgentSession,
  commitAgentSessionChanges,
  revertAgentSessionChanges,
  deployAgentSession,
  finishAgentSession,
  sendAgentMessage,
  retryAgentTurn,
  stopAgentTurn,
  clearAgentSessionLogs,
  endAgentSession,
  cancelAgentSession,
  archiveAgentSession,
  archiveLiveSessionForBranch,
  recreateAgentSession,
} from "./agent-session-lifecycle";
