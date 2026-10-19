import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  projects,
  type AgentSessionSource,
  type AgentSessionStatus,
  type Project,
} from "@/lib/db/schema";
import {
  failedTurnEventSeq,
  findFailedTurnPrompt,
} from "@/lib/agent-turn";
import { markAgentSessionIdle, markAgentSessionLive } from "@/lib/agent-state";
import { isInactiveAgentSessionStatus } from "@/lib/agent-session-source";
import {
  listLocalBranches,
  ensureLocalBranchForAgent,
  prepareAgentWorkspace,
  commitAllChanges,
  buildAgentCommitMessage,
  hasUnpushedCommits,
  pushBranch,
  revertAgentBranchWorkspace,
  revertAgentSessionCommit as revertPushedAgentCommit,
  validateBranchName,
  fetchTrackingBranch,
} from "@/lib/git-workspace";
import { projectRemoteUrl } from "@/lib/project-git-remote";
import { createBranchWorkspace, destroyBranchWorkspace, ensureBranchWorkspace } from "@/lib/branch-workspace";
import { setAgentContainerKillReason } from "@/lib/agent-container";
import { resolveRequestedBackend } from "@/lib/agent-backends/registry";
import type { AgentBackendId } from "@/lib/agent-backends/types";
import { transition } from "@/lib/agent-session-machine";
import { buildAgentRestartPrompt } from "@/lib/agent-restart-transcript";
import {
  ACTIVE_TURN_STATUSES,
  TERMINAL_STATUSES,
  appendSessionLog,
  cancelDeploymentPoll,
  cancelledSessions,
  deleteEventsFromSeq,
  deployAfterAgent,
  drainAgentQueue,
  endedSessions,
  executeAgentTurn,
  finalizeSessionAfterFailedTurn,
  finalizeSessionAfterSuccessfulTurn,
  isAgentRuntimeActive,
  joinOrRunAgentTurn,
  noteDeferredAgentFollowUp,
  takeDeferredAgentFollowUp,
  waitForInFlightAgentTurn,
  reactivateFailedSession,
  reactivateSession,
  runAgentTurn,
  stopAgentRuntime,
  stoppingSessions,
  updateSessionStatus,
  waitForDeploymentAndFinalize,
  assertNoConflictingActiveSession,
  shouldQueueAgentSession,
  queueAgentSession,
  getAgentSession,
  getAllAgentEventsAfter,
  getSessionForBranch,
} from "@/lib/agent-runner";

export async function createAgentBranch(
  projectId: string,
  newBranch: string,
): Promise<void> {
  const trimmedBranch = newBranch.trim();
  const validationError = validateBranchName(trimmedBranch);
  if (validationError) throw new Error(validationError);

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) throw new Error("Project not found");

  if (trimmedBranch === project.branch) {
    throw new Error(
      `Cannot create a branch named "${trimmedBranch}" — that is the deploy branch`,
    );
  }

  const localBranches = await listLocalBranches(project.clonePath);
  if (localBranches.includes(trimmedBranch)) {
    throw new Error(`Branch "${trimmedBranch}" already exists`);
  }

  await createBranchWorkspace(project, trimmedBranch);
  await fetchTrackingBranch(project.clonePath, trimmedBranch);
}

async function startAgentWithUserMessage(
  sessionId: string,
  prompt: string,
): Promise<void> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) throw new Error("Prompt is required");

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (session.archivedAt) {
    throw new Error("Archived sessions are read-only");
  }
  if (session.source === "recovery") {
    throw new Error("Deploy recovery agents start automatically after a failed deploy");
  }
  if (session.source === "rebase-recovery") {
    throw new Error("Rebase recovery agents start automatically after a failed rebase");
  }

  if (ACTIVE_TURN_STATUSES.includes(session.status)) {
    await sendAgentMessage(sessionId, trimmedPrompt);
    return;
  }

  if (session.status === "idle" || TERMINAL_STATUSES.includes(session.status)) {
    if (TERMINAL_STATUSES.includes(session.status)) {
      reactivateSession(sessionId);
    }
    markAgentSessionLive(sessionId, session.projectId);
    updateSessionStatus(sessionId, "pending");
    void executeAgentTurn(sessionId, session.projectId, trimmedPrompt);
    return;
  }

  throw new Error("Session cannot be started");
}

export async function createAgentSession(
  projectId: string,
  branch: string,
  prompt: string,
  options?: {
    source?: AgentSessionSource;
    ticketId?: string | null;
    backend?: string | null;
    requireAvailable?: boolean;
  },
): Promise<{ sessionId: string; queued: boolean }> {
  const trimmedBranch = branch.trim();
  if (!trimmedBranch) throw new Error("Branch is required");
  if (!prompt.trim()) throw new Error("Prompt is required");
  const backend: AgentBackendId = resolveRequestedBackend(options?.backend, {
    requireAvailable: options?.requireAvailable,
  });

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) throw new Error("Project not found");

  await ensureLocalBranchForAgent(
    projectRemoteUrl(project),
    project.branch,
    project.clonePath,
    trimmedBranch,
    () => {},
  );

  if (shouldQueueAgentSession(projectId, trimmedBranch)) {
    return queueAgentSession(projectId, trimmedBranch, prompt.trim(), backend);
  }

  assertNoConflictingActiveSession(projectId, trimmedBranch);

  const existing = getSessionForBranch(projectId, trimmedBranch);

  if (existing) {
    if (ACTIVE_TURN_STATUSES.includes(existing.status)) {
      await sendAgentMessage(existing.id, prompt.trim());
      return { sessionId: existing.id, queued: false };
    }

    if (existing.status === "idle" || isInactiveAgentSessionStatus(existing.status)) {
      db.update(agentSessions)
        .set({
          initialPrompt: prompt.trim(),
          source: options?.source ?? existing.source,
          ticketId:
            options?.ticketId !== undefined
              ? options.ticketId
              : existing.ticketId,
        })
        .where(eq(agentSessions.id, existing.id))
        .run();
      await startAgentWithUserMessage(existing.id, prompt.trim());
      return { sessionId: existing.id, queued: false };
    }

    throw new Error(`Session on "${trimmedBranch}" is in an unexpected state`);
  }

  const sessionId = randomUUID();

  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId,
      branch: trimmedBranch,
      status: "idle",
      source: options?.source ?? "manual",
      ticketId: options?.ticketId ?? null,
      backend,
      initialPrompt: prompt.trim(),
      logs: "",
      startedAt: new Date(),
    })
    .run();

  await startAgentWithUserMessage(sessionId, prompt.trim());

  return { sessionId, queued: false };
}

export async function waitForAgentSessionTerminal(
  sessionId: string,
  timeoutMs = 30 * 60_000,
): Promise<ReturnType<typeof getAgentSession>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = getAgentSession(sessionId);
    if (session && TERMINAL_STATUSES.includes(session.status)) {
      return session;
    }
    if (session && !isAgentRuntimeActive(sessionId)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const refreshed = getAgentSession(sessionId);
      if (refreshed && TERMINAL_STATUSES.includes(refreshed.status)) {
        return refreshed;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return getAgentSession(sessionId);
}

export async function createRecoveryAgentSession(
  project: Project,
  branch: string,
  prompt: string,
  options?: { workspacePath?: string },
): Promise<string> {
  const trimmedBranch = branch.trim();
  if (!trimmedBranch) throw new Error("Branch is required");
  if (!prompt.trim()) throw new Error("Prompt is required");

  await ensureLocalBranchForAgent(
    projectRemoteUrl(project),
    project.branch,
    options?.workspacePath ?? project.clonePath,
    trimmedBranch,
    () => {},
  );

  assertNoConflictingActiveSession(project.id, trimmedBranch);

  const existing = getSessionForBranch(project.id, trimmedBranch);

  if (existing) {
    if (ACTIVE_TURN_STATUSES.includes(existing.status)) {
      await sendAgentMessage(existing.id, prompt.trim());
      return existing.id;
    }

    db.update(agentSessions)
      .set({
        status: "pending",
        source: "recovery",
        initialPrompt: prompt.trim(),
        errorMessage: null,
        completedAt: null,
        deploymentId: null,
        commitSha: null,
        failedTurnStartSeq: null,
      })
      .where(eq(agentSessions.id, existing.id))
      .run();
    markAgentSessionLive(existing.id, project.id);
    void executeAgentTurn(existing.id, project.id, prompt.trim(), options);
    return existing.id;
  }

  const sessionId = randomUUID();
  markAgentSessionLive(sessionId, project.id);

  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId: project.id,
      branch: trimmedBranch,
      status: "pending",
      source: "recovery",
      backend: resolveRequestedBackend(null),
      initialPrompt: prompt.trim(),
      logs: "",
      startedAt: new Date(),
    })
    .run();

  void executeAgentTurn(sessionId, project.id, prompt.trim(), options);

  return sessionId;
}

export async function createRebaseRecoveryAgentSession(
  project: Project,
  branch: string,
  prompt: string,
): Promise<string> {
  const trimmedBranch = branch.trim();
  if (!trimmedBranch) throw new Error("Branch is required");
  if (!prompt.trim()) throw new Error("Prompt is required");

  await ensureLocalBranchForAgent(
    projectRemoteUrl(project),
    project.branch,
    project.clonePath,
    trimmedBranch,
    () => {},
  );

  assertNoConflictingActiveSession(project.id, trimmedBranch);

  const existing = getSessionForBranch(project.id, trimmedBranch);

  if (existing) {
    if (ACTIVE_TURN_STATUSES.includes(existing.status)) {
      await sendAgentMessage(existing.id, prompt.trim());
      return existing.id;
    }

    db.update(agentSessions)
      .set({
        status: "pending",
        source: "rebase-recovery",
        initialPrompt: prompt.trim(),
        errorMessage: null,
        completedAt: null,
        deploymentId: null,
        commitSha: null,
        failedTurnStartSeq: null,
      })
      .where(eq(agentSessions.id, existing.id))
      .run();
    markAgentSessionLive(existing.id, project.id);
    void executeAgentTurn(existing.id, project.id, prompt.trim());
    return existing.id;
  }

  const sessionId = randomUUID();
  markAgentSessionLive(sessionId, project.id);

  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId: project.id,
      branch: trimmedBranch,
      status: "pending",
      source: "rebase-recovery",
      backend: resolveRequestedBackend(null),
      initialPrompt: prompt.trim(),
      logs: "",
      startedAt: new Date(),
    })
    .run();

  void executeAgentTurn(sessionId, project.id, prompt.trim());

  return sessionId;
}

function assertSessionReadyForPostAgentAction(sessionId: string) {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");

  const allowedStatuses: AgentSessionStatus[] = ["running", "completed", "failed"];
  if (!allowedStatuses.includes(session.status)) {
    throw new Error("Session is not ready for commit or deploy");
  }
  if (isAgentRuntimeActive(sessionId)) {
    throw new Error("Agent is still processing; wait for the current turn to finish");
  }
  if (session.status === "deploying") {
    throw new Error("Deployment already in progress");
  }

  return session;
}

function assertSessionReadyForFinish(sessionId: string) {
  const session = assertSessionReadyForPostAgentAction(sessionId);
  const allowedStatuses: AgentSessionStatus[] = ["running", "completed", "failed"];
  if (!allowedStatuses.includes(session.status)) {
    throw new Error("Session is not ready to finish and deploy");
  }
  return session;
}

export async function commitAgentSessionChanges(
  sessionId: string,
  options?: { message?: string; workspacePath?: string },
): Promise<{ commitSha: string | null; committed: boolean; pushed: boolean }> {
  const session = assertSessionReadyForPostAgentAction(sessionId);

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .get();

  if (!project) throw new Error("Project not found");

  const log = (msg: string) => appendSessionLog(sessionId, msg);
  const workspacePath =
    options?.workspacePath ??
    (await ensureBranchWorkspace(project, session.branch)).workspacePath;

  await prepareAgentWorkspace(
    projectRemoteUrl(project),
    project.branch,
    workspacePath,
    session.branch,
    log,
  );

  const message =
    options?.message?.trim() || buildAgentCommitMessage(session.initialPrompt);

  const commitSha = await commitAllChanges(workspacePath, message, log);

  const shouldPush =
    commitSha !== null ||
    (await hasUnpushedCommits(workspacePath, session.branch));

  if (shouldPush) {
    await pushBranch(workspacePath, session.branch, log);
  }

  if (commitSha) {
    db.update(agentSessions)
      .set({ commitSha })
      .where(eq(agentSessions.id, sessionId))
      .run();
  }

  return {
    commitSha,
    committed: commitSha !== null,
    pushed: shouldPush,
  };
}

export async function revertAgentSessionChanges(sessionId: string): Promise<void> {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (!session.commitSha) {
    throw new Error("Session has no commit to revert");
  }
  if (ACTIVE_TURN_STATUSES.includes(session.status)) {
    throw new Error("Cannot revert while the agent is active");
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .get();
  if (!project) throw new Error("Project not found");

  const log = (msg: string) => appendSessionLog(sessionId, msg);
  const workspacePath = (
    await ensureBranchWorkspace(project, session.branch)
  ).workspacePath;
  await prepareAgentWorkspace(
    projectRemoteUrl(project),
    project.branch,
    workspacePath,
    session.branch,
    log,
  );

  await revertPushedAgentCommit(
    workspacePath,
    session.branch,
    session.commitSha,
    log,
  );

  db.update(agentSessions)
    .set({ commitSha: null })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export async function deployAgentSession(sessionId: string): Promise<void> {
  const session = assertSessionReadyForPostAgentAction(sessionId);

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .get();

  if (!project) throw new Error("Project not found");

  const log = (msg: string) => appendSessionLog(sessionId, msg);

  await prepareAgentWorkspace(
    projectRemoteUrl(project),
    project.branch,
    (await ensureBranchWorkspace(project, session.branch)).workspacePath,
    session.branch,
    log,
  );

  await deployAfterAgent(sessionId, session.projectId, session.branch);
  await waitForDeploymentAndFinalize(sessionId, session.projectId);
}

export async function finishAgentSession(sessionId: string): Promise<void> {
  const session = assertSessionReadyForFinish(sessionId);

  await commitAgentSessionChanges(sessionId);
  await deployAfterAgent(sessionId, session.projectId, session.branch);
  await waitForDeploymentAndFinalize(sessionId, session.projectId);
}

export async function sendAgentMessage(
  sessionId: string,
  prompt: string,
): Promise<void> {
  if (!prompt.trim()) throw new Error("Prompt is required");

  const trimmedPrompt = prompt.trim();
  if (noteDeferredAgentFollowUp(sessionId, trimmedPrompt)) {
    await waitForInFlightAgentTurn(sessionId);
    const queued = takeDeferredAgentFollowUp(sessionId);
    if (!queued) return;
    return sendAgentMessage(sessionId, queued);
  }

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (session.archivedAt) {
    throw new Error("Archived sessions are read-only");
  }
  if (session.status === "idle") {
    markAgentSessionLive(sessionId, session.projectId);
    updateSessionStatus(sessionId, "pending");
    void executeAgentTurn(sessionId, session.projectId, trimmedPrompt);
    return;
  }
  if (TERMINAL_STATUSES.includes(session.status)) {
    throw new Error("Session is no longer active");
  }
  if (session.status === "deploying") {
    throw new Error("Session is deploying; wait for completion before sending more messages");
  }
  if (isAgentRuntimeActive(sessionId)) {
    throw new Error("Agent is still processing the previous message");
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .get();

  if (!project) throw new Error("Project not found");

  const log = (msg: string) => appendSessionLog(sessionId, msg);
  try {
    const outcome = await joinOrRunAgentTurn(sessionId, async () => {
      await prepareAgentWorkspace(
        projectRemoteUrl(project),
        project.branch,
        (await ensureBranchWorkspace(project, session.branch)).workspacePath,
        session.branch,
        log,
      );
      await runAgentTurn(sessionId, project, trimmedPrompt);
      await finalizeSessionAfterSuccessfulTurn(sessionId, session.projectId);
    });
    if (outcome === "joined") return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finalizeSessionAfterFailedTurn(sessionId, session.projectId, message);
    throw err;
  }
}

export async function retryAgentTurn(sessionId: string): Promise<string> {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.status !== "failed") {
    throw new Error("Only failed agent turns can be retried");
  }
  if (isAgentRuntimeActive(sessionId)) {
    throw new Error("Agent is still processing");
  }

  const events = getAllAgentEventsAfter(sessionId, 0);
  const prompt = findFailedTurnPrompt(events, session.failedTurnStartSeq);
  if (!prompt) {
    throw new Error("Could not find the failed prompt to retry");
  }

  const fromSeq = failedTurnEventSeq(events, session.failedTurnStartSeq);
  if (fromSeq == null) {
    throw new Error("Could not find the failed turn to retry");
  }

  deleteEventsFromSeq(sessionId, fromSeq);
  reactivateFailedSession(sessionId);
  markAgentSessionLive(sessionId, session.projectId);
  appendSessionLog(sessionId, `Retrying failed turn: ${prompt.slice(0, 80)}…`);
  void executeAgentTurn(sessionId, session.projectId, prompt);
  return prompt;
}

export async function stopAgentTurn(sessionId: string): Promise<void> {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (TERMINAL_STATUSES.includes(session.status)) return;
  if (session.status === "deploying") {
    await endAgentSession(sessionId);
    return;
  }
  if (!isAgentRuntimeActive(sessionId)) {
    await endAgentSession(sessionId);
    return;
  }

  stoppingSessions.add(sessionId);
  await stopAgentRuntime(sessionId);

  appendSessionLog(sessionId, "Agent stopped by user.");
}

export function clearAgentSessionLogs(sessionId: string): void {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (isAgentRuntimeActive(sessionId)) {
    throw new Error("Cannot clear logs while the agent is running");
  }

  db.update(agentSessions)
    .set({ logs: "" })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

export async function endAgentSession(
  sessionId: string,
  options?: { revertChanges?: boolean },
): Promise<void> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (session.status === "queued") {
    appendSessionLog(sessionId, "Queued session cancelled by user.");
    updateSessionStatus(sessionId, "cancelled", { completedAt: new Date() });
    return;
  }
  if (session.status === "idle" || TERMINAL_STATUSES.includes(session.status)) {
    return;
  }

  cancelDeploymentPoll(sessionId);

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, session.projectId))
    .get();
  if (!project) throw new Error("Project not found");

  if (isAgentRuntimeActive(sessionId)) {
    endedSessions.add(sessionId);
    stoppingSessions.delete(sessionId);
    await stopAgentRuntime(sessionId);
  }

  cancelDeploymentPoll(sessionId);

  const log = (msg: string) => appendSessionLog(sessionId, msg);

  if (options?.revertChanges) {
    try {
      await revertAgentBranchWorkspace(
        (await ensureBranchWorkspace(project, session.branch)).workspacePath,
        session.branch,
        log,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to revert workspace: ${message}`);
    }
  }

  transition(sessionId, { type: "operator_stop", reason: "end" });
  log(
    options?.revertChanges
      ? "Session ended by user; uncommitted workspace changes were reverted."
      : "Session ended by user.",
  );
  markAgentSessionIdle(sessionId, session.projectId);
  drainAgentQueue(session.projectId);
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (session.status === "queued") {
    appendSessionLog(sessionId, "Queued session cancelled by user.");
    updateSessionStatus(sessionId, "cancelled", { completedAt: new Date() });
    return;
  }
  if (session.status === "idle" || TERMINAL_STATUSES.includes(session.status)) {
    return;
  }

  cancelledSessions.add(sessionId);
  cancelDeploymentPoll(sessionId);
  if (isAgentRuntimeActive(sessionId)) {
    await stopAgentRuntime(sessionId);
  }

  appendSessionLog(sessionId, "Session cancelled by user.");
  updateSessionStatus(sessionId, "cancelled", { completedAt: new Date() });
  markAgentSessionIdle(sessionId, session.projectId);
  drainAgentQueue(session.projectId);
}

export async function endAgentAndDestroyBranchWorkspace(
  projectId: string,
  branch: string,
  reason: "branch_merged" | "branch_deleted",
): Promise<void> {
  const session = getSessionForBranch(projectId, branch);
  if (session && !session.archivedAt) {
    const live =
      session.status === "queued" ||
      session.status === "idle" ||
      ACTIVE_TURN_STATUSES.includes(session.status);
    if (live) {
      endedSessions.add(session.id);
      appendSessionLog(
        session.id,
        reason === "branch_merged"
          ? `Agent ended because branch "${branch}" was merged.`
          : `Agent ended because branch "${branch}" was deleted.`,
      );
      if (isAgentRuntimeActive(session.id)) {
        await stopAgentRuntime(session.id);
      }
      setAgentContainerKillReason(session.id, reason);
      transition(session.id, { type: "kill", reason });
      markAgentSessionIdle(session.id, projectId);
    }
    if (!session.archivedAt) {
      transition(session.id, { type: "archive" });
    }
  }
  await destroyBranchWorkspace(projectId, branch);
}

/** End (if needed) and soft-archive a session so its branch can host a new live session. */
export async function archiveAgentSession(
  sessionId: string,
  options?: { revertChanges?: boolean },
): Promise<void> {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.archivedAt) return;

  await endAgentSession(sessionId, options);
  transition(sessionId, { type: "archive" });
  appendSessionLog(sessionId, "Session archived.");
}

/** Archive the live session for a branch, if any. */
export async function archiveLiveSessionForBranch(
  projectId: string,
  branch: string,
): Promise<string | null> {
  const existing = getSessionForBranch(projectId, branch);
  if (!existing) return null;
  await archiveAgentSession(existing.id);
  return existing.id;
}

/**
 * Archive the live session on a branch (if any) and start a fresh agent with a new prompt.
 * Clears Cursor resume ids by creating a brand-new session row.
 */
export async function recreateAgentSession(
  projectId: string,
  branch: string,
  prompt: string,
  options?: { backend?: string | null; requireAvailable?: boolean },
): Promise<{ sessionId: string; queued: boolean; archivedSessionId: string | null }> {
  const trimmedBranch = branch.trim();
  const trimmedPrompt = prompt.trim();
  if (!trimmedBranch) throw new Error("Branch is required");
  if (!trimmedPrompt) throw new Error("Prompt is required");

  const archivedSessionId = await archiveLiveSessionForBranch(
    projectId,
    trimmedBranch,
  );
  const created = await createAgentSession(projectId, trimmedBranch, trimmedPrompt, {
    backend: options?.backend,
    requireAvailable: options?.requireAvailable,
  });
  return { ...created, archivedSessionId };
}

export async function restartAgentSession(
  sessionId: string,
): Promise<{ sessionId: string; queued: boolean; archivedSessionId: string | null }> {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.archivedAt) {
    throw new Error("Archived sessions cannot be restarted");
  }
  const events = getAllAgentEventsAfter(sessionId, 0);
  const prompt = buildAgentRestartPrompt({
    initialPrompt: session.initialPrompt,
    events,
    contextCompact: session.contextCompact,
  });
  return recreateAgentSession(session.projectId, session.branch, prompt, {
    backend: session.backend,
    requireAvailable: false,
  });
}


