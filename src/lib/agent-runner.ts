import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { and, desc, eq, gt, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentEvents,
  agentSessions,
  deployments,
  projects,
  type AgentSessionStatus,
  type Project,
} from "@/lib/db/schema";
import { parseStreamEventLine, sessionEventsHaveFileEdits } from "@/lib/agent-stream";
import {
  canRetryFailedAgentTurn,
  failedTurnEventSeq,
  findFailedTurnPrompt,
  isAgentTurnComplete,
  isStuckActiveSession,
} from "@/lib/agent-turn";
import { activeAgentProjects, getActiveSessionForProject, isAgentSessionActive } from "@/lib/agent-state";
import {
  agentSessionSourceLabel,
  isInactiveAgentSessionStatus,
  resolveAgentSessionSource,
} from "@/lib/agent-session-source";
import {
  listLocalBranches,
  prepareAgentWorkspace,
  commitAllChanges,
  buildAgentCommitMessage,
  hasUncommittedChanges,
  hasUnpushedCommits,
  pushBranch,
  revertAgentBranchWorkspace,
  createLocalBranchFromBase,
  validateBranchName,
} from "@/lib/github";
import { resolveCursorAgentBin } from "@/lib/cursor-agent";
import { runDeployment } from "@/lib/deployer";
import { resolveClonePath } from "@/lib/paths";

const activeAgentProcesses = new Map<string, ChildProcess>();
const stoppingSessions = new Set<string>();
const cancelledSessions = new Set<string>();
const deploymentPollTimers = new Map<string, NodeJS.Timeout>();
const deploymentPollActive = new Set<string>();

const AGENT_KILL_GRACE_MS = 5000;

const TERMINAL_STATUSES: AgentSessionStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

const ACTIVE_TURN_STATUSES: AgentSessionStatus[] = [
  "pending",
  "running",
  "deploying",
];

function spawnAgentProcess(
  args: string[],
  options: Parameters<typeof spawn>[2],
): ReturnType<typeof spawn> {
  const agentPath = resolveCursorAgentBin();
  // Line-buffer stdout so stream-json partial events reach the DB/SSE promptly.
  if (existsSync("/usr/bin/stdbuf")) {
    return spawn("stdbuf", ["-oL", "-eL", agentPath, ...args], options);
  }
  return spawn(agentPath, args, options);
}

function terminateAgentProcess(proc: ChildProcess): void {
  const pid = proc.pid;
  if (!pid || proc.killed) return;

  try {
    proc.kill("SIGTERM");
  } catch {
    // process may already be gone
  }

  setTimeout(() => {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      // already exited
    }
  }, AGENT_KILL_GRACE_MS);
}

function cancelDeploymentPoll(sessionId: string): void {
  deploymentPollActive.delete(sessionId);
  const timer = deploymentPollTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    deploymentPollTimers.delete(sessionId);
  }
}

function appendSessionLog(sessionId: string, message: string): void {
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

function updateSessionStatus(
  sessionId: string,
  status: AgentSessionStatus,
  extra?: {
    cursorSessionId?: string;
    errorMessage?: string | null;
    completedAt?: Date;
    deploymentId?: string;
    commitSha?: string;
  },
): void {
  db.update(agentSessions)
    .set({ status, ...extra })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

function getNextEventSeq(sessionId: string): number {
  const row = db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
    .get();
  return (row?.seq ?? 0) + 1;
}

function recordEvent(sessionId: string, eventType: string, payload: string): void {
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

function markTurnSucceeded(sessionId: string): void {
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

function markTurnFailed(sessionId: string, turnStartSeq: number): void {
  db.update(agentSessions)
    .set({ failedTurnStartSeq: turnStartSeq })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

function deleteEventsFromSeq(sessionId: string, fromSeq: number): void {
  db.delete(agentEvents)
    .where(and(eq(agentEvents.sessionId, sessionId), gte(agentEvents.seq, fromSeq)))
    .run();
}

function reactivateSession(sessionId: string): void {
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

function reactivateFailedSession(sessionId: string): void {
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
  return activeAgentProcesses.has(sessionId);
}

export type AgentSessionForClient = NonNullable<ReturnType<typeof getAgentSession>> & {
  hasActiveProcess: boolean;
  canRetry: boolean;
  hasFileEdits: boolean;
  sessionSource: ReturnType<typeof resolveAgentSessionSource>;
  sessionSourceLabel: string;
};

function withClientFields(session: NonNullable<ReturnType<typeof getAgentSession>>): AgentSessionForClient {
  const events = getAllAgentEventsAfter(session.id, 0);
  const sessionSource = resolveAgentSessionSource(session);
  return {
    ...session,
    hasActiveProcess: isAgentProcessRunning(session.id),
    canRetry: canRetryFailedAgentTurn(session, events),
    hasFileEdits: sessionEventsHaveFileEdits(events),
    sessionSource,
    sessionSourceLabel: agentSessionSourceLabel(sessionSource),
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
      project.githubRepo,
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

export function reconcileStuckAgentSession(sessionId: string) {
  const session = getAgentSession(sessionId);
  if (!session) return undefined;

  const events = getAllAgentEventsAfter(sessionId, 0);
  const turnIncomplete =
    session.status === "running" && !isAgentTurnComplete(events);

  const stuck = isStuckActiveSession({
    status: session.status,
    failedTurnStartSeq: session.failedTurnStartSeq,
    hasActiveProcess: activeAgentProcesses.has(sessionId),
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
      and(eq(agentSessions.projectId, projectId), eq(agentSessions.branch, branch)),
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

function assertNoConflictingActiveSession(
  projectId: string,
  branch: string,
): void {
  if (!isAgentSessionActive(projectId)) return;

  const active = getActiveSessionForProject(projectId);
  if (active && active.branch !== branch) {
    throw new Error(
      `An agent is active on branch "${active.branch}". Finish or cancel it before working on "${branch}".`,
    );
  }
}

function buildAgentArgs(
  prompt: string,
  cursorSessionId?: string | null,
): string[] {
  const args = [
    "-p",
    "--force",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
  ];

  if (cursorSessionId) {
    args.push("--resume", cursorSessionId);
  }

  args.push(prompt);
  return args;
}

async function runAgentTurn(
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
  appendSessionLog(sessionId, `Starting agent turn: ${prompt.slice(0, 80)}…`);

  const turnStartSeq = getNextEventSeq(sessionId);
  recordEvent(sessionId, "user", JSON.stringify({ type: "user", text: prompt }));

  const args = buildAgentArgs(prompt, session.resumeCursorSessionId);
  const env = { ...process.env };
  const apiKey = process.env.FORGE_CURSOR_API_KEY ?? process.env.CURSOR_API_KEY;
  if (apiKey) env.CURSOR_API_KEY = apiKey;

  return new Promise((resolve, reject) => {
    const proc = spawnAgentProcess(args, {
      cwd: resolveClonePath(workspacePath ?? project.clonePath),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeAgentProcesses.set(sessionId, proc);

    let stdoutBuffer = "";

    const handleLine = (line: string) => {
      const event = parseStreamEventLine(line);
      if (!event) return;

      if (event.type) {
        recordEvent(sessionId, event.type, line);
      }

      if (event.type === "system" && event.subtype === "init" && event.session_id) {
        db.update(agentSessions)
          .set({ cursorSessionId: event.session_id })
          .where(eq(agentSessions.id, sessionId))
          .run();
      }
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      appendSessionLog(sessionId, `stderr: ${chunk.toString().trimEnd()}`);
    });

    proc.on("error", (err) => {
      activeAgentProcesses.delete(sessionId);
      markTurnFailed(sessionId, turnStartSeq);
      reject(err);
    });

    proc.on("close", (code) => {
      activeAgentProcesses.delete(sessionId);
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer);

      if (cancelledSessions.has(sessionId)) {
        cancelledSessions.delete(sessionId);
        resolve();
        return;
      }

      if (stoppingSessions.has(sessionId)) {
        stoppingSessions.delete(sessionId);
        markTurnFailed(sessionId, turnStartSeq);
        updateSessionStatus(sessionId, "failed", {
          errorMessage: "Stopped by user.",
        });
        appendSessionLog(sessionId, "Agent stopped by user.");
        activeAgentProjects.delete(project.id);
        resolve();
        return;
      }

      if (code !== 0 && code !== null) {
        markTurnFailed(sessionId, turnStartSeq);
        reject(new Error(`Agent exited with code ${code}`));
        return;
      }
      markTurnSucceeded(sessionId);
      resolve();
    });
  });
}

async function deployAfterAgent(
  sessionId: string,
  projectId: string,
  branch: string,
): Promise<void> {
  updateSessionStatus(sessionId, "deploying");
  appendSessionLog(sessionId, "Agent finished. Starting rebuild and release…");

  try {
    const deploymentId = await runDeployment(projectId, "agent", {
      branch,
      skipPull: true,
    });

    db.update(agentSessions)
      .set({ deploymentId })
      .where(eq(agentSessions.id, sessionId))
      .run();

    appendSessionLog(sessionId, `Deployment ${deploymentId} started.`);
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

async function waitForDeploymentAndFinalize(
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

    if (dep.status === "success") {
      appendSessionLog(sessionId, "Rebuild and release completed successfully.");
      updateSessionStatus(sessionId, "completed", { completedAt: new Date() });
    } else {
      appendSessionLog(
        sessionId,
        `Deployment failed: ${dep.errorMessage ?? "unknown"}`,
      );
      updateSessionStatus(sessionId, "failed", {
        errorMessage: dep.errorMessage ?? "Deployment failed",
        completedAt: new Date(),
      });
    }
    activeAgentProjects.delete(projectId);
  };

  deploymentPollTimers.set(sessionId, setTimeout(poll, 2000));
}

async function executeAgentTurn(
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
      project.githubRepo,
      project.branch,
      options?.workspacePath ?? project.clonePath,
      session.branch,
      log,
    );

    await runAgentTurn(sessionId, project, prompt, options?.workspacePath);
    const afterTurn = getAgentSession(sessionId);
    if (afterTurn && !TERMINAL_STATUSES.includes(afterTurn.status)) {
      await maybeAutoFinishSessionIfNoEdits(sessionId, projectId);
      const refreshed = getAgentSession(sessionId);
      if (
        refreshed &&
        refreshed.status !== "completed" &&
        !TERMINAL_STATUSES.includes(refreshed.status)
      ) {
        updateSessionStatus(sessionId, "running");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    const current = getAgentSession(sessionId);
    if (current && current.failedTurnStartSeq == null) {
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
  }
}

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

  assertNoConflictingActiveSession(projectId, trimmedBranch);

  const localBranches = await listLocalBranches(project.clonePath);
  if (localBranches.includes(trimmedBranch)) {
    throw new Error(`Branch "${trimmedBranch}" already exists`);
  }

  await createLocalBranchFromBase(
    project.githubRepo,
    project.branch,
    project.clonePath,
    trimmedBranch,
    () => {},
  );
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
  if (session.source === "recovery") {
    throw new Error("Deploy recovery agents start automatically after a failed deploy");
  }

  if (ACTIVE_TURN_STATUSES.includes(session.status)) {
    await sendAgentMessage(sessionId, trimmedPrompt);
    return;
  }

  if (session.status === "idle" || TERMINAL_STATUSES.includes(session.status)) {
    if (TERMINAL_STATUSES.includes(session.status)) {
      reactivateSession(sessionId);
    }
    activeAgentProjects.add(session.projectId);
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
): Promise<string> {
  const trimmedBranch = branch.trim();
  if (!trimmedBranch) throw new Error("Branch is required");
  if (!prompt.trim()) throw new Error("Prompt is required");

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  if (!project) throw new Error("Project not found");

  const localBranches = await listLocalBranches(project.clonePath);
  if (!localBranches.includes(trimmedBranch)) {
    throw new Error(
      `Branch "${trimmedBranch}" not found locally. Fetch or create the branch in git first.`,
    );
  }

  assertNoConflictingActiveSession(projectId, trimmedBranch);

  const existing = getSessionForBranch(projectId, trimmedBranch);

  if (existing) {
    if (ACTIVE_TURN_STATUSES.includes(existing.status)) {
      await sendAgentMessage(existing.id, prompt.trim());
      return existing.id;
    }

    if (existing.status === "idle") {
      db.update(agentSessions)
        .set({ initialPrompt: prompt.trim() })
        .where(eq(agentSessions.id, existing.id))
        .run();
      await startAgentWithUserMessage(existing.id, prompt.trim());
      return existing.id;
    }

    if (isInactiveAgentSessionStatus(existing.status)) {
      db.update(agentSessions)
        .set({ initialPrompt: prompt.trim() })
        .where(eq(agentSessions.id, existing.id))
        .run();
      await startAgentWithUserMessage(existing.id, prompt.trim());
      return existing.id;
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
      source: "manual",
      initialPrompt: prompt.trim(),
      logs: "",
      startedAt: new Date(),
    })
    .run();

  await startAgentWithUserMessage(sessionId, prompt.trim());

  return sessionId;
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
    if (session && !activeAgentProcesses.has(sessionId)) {
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

  const localBranches = await listLocalBranches(
    options?.workspacePath ?? project.clonePath,
  );
  if (!localBranches.includes(trimmedBranch)) {
    throw new Error(
      `Branch "${trimmedBranch}" not found locally. Fetch or create the branch in git first.`,
    );
  }

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
    activeAgentProjects.add(project.id);
    void executeAgentTurn(existing.id, project.id, prompt.trim(), options);
    return existing.id;
  }

  const sessionId = randomUUID();
  activeAgentProjects.add(project.id);

  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId: project.id,
      branch: trimmedBranch,
      status: "pending",
      source: "recovery",
      initialPrompt: prompt.trim(),
      logs: "",
      startedAt: new Date(),
    })
    .run();

  void executeAgentTurn(sessionId, project.id, prompt.trim(), options);

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
  if (activeAgentProcesses.has(sessionId)) {
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
  const workspacePath = options?.workspacePath ?? project.clonePath;

  await prepareAgentWorkspace(
    project.githubRepo,
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
    project.githubRepo,
    project.branch,
    project.clonePath,
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

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (session.status === "idle") {
    activeAgentProjects.add(session.projectId);
    updateSessionStatus(sessionId, "pending");
    void executeAgentTurn(sessionId, session.projectId, prompt.trim());
    return;
  }
  if (TERMINAL_STATUSES.includes(session.status)) {
    throw new Error("Session is no longer active");
  }
  if (session.status === "deploying") {
    throw new Error("Session is deploying; wait for completion before sending more messages");
  }
  if (activeAgentProcesses.has(sessionId)) {
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
    await prepareAgentWorkspace(
      project.githubRepo,
      project.branch,
      project.clonePath,
      session.branch,
      log,
    );
    await runAgentTurn(sessionId, project, prompt.trim());
    const afterTurn = getAgentSession(sessionId);
    if (afterTurn && !TERMINAL_STATUSES.includes(afterTurn.status)) {
      await maybeAutoFinishSessionIfNoEdits(sessionId, session.projectId);
      const refreshed = getAgentSession(sessionId);
      if (
        refreshed &&
        refreshed.status !== "completed" &&
        !TERMINAL_STATUSES.includes(refreshed.status)
      ) {
        updateSessionStatus(sessionId, "running");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendSessionLog(sessionId, `ERROR: ${message}`);
    updateSessionStatus(sessionId, "failed", {
      errorMessage: message,
      completedAt: new Date(),
    });
    activeAgentProjects.delete(session.projectId);
    throw err;
  }
}

export async function retryAgentTurn(sessionId: string): Promise<string> {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.status !== "failed") {
    throw new Error("Only failed agent turns can be retried");
  }
  if (activeAgentProcesses.has(sessionId)) {
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
  activeAgentProjects.add(session.projectId);
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
  if (!activeAgentProcesses.has(sessionId)) {
    await endAgentSession(sessionId);
    return;
  }

  stoppingSessions.add(sessionId);
  const proc = activeAgentProcesses.get(sessionId);
  if (proc) {
    terminateAgentProcess(proc);
  }

  appendSessionLog(sessionId, "Agent stopped by user.");
}

export function clearAgentSessionLogs(sessionId: string): void {
  const session = getAgentSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (isAgentProcessRunning(sessionId)) {
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

  const proc = activeAgentProcesses.get(sessionId);
  if (proc) {
    stoppingSessions.add(sessionId);
    terminateAgentProcess(proc);
    activeAgentProcesses.delete(sessionId);
  }

  cancelDeploymentPoll(sessionId);

  const log = (msg: string) => appendSessionLog(sessionId, msg);

  if (options?.revertChanges) {
    try {
      await revertAgentBranchWorkspace(project.clonePath, session.branch, log);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to revert workspace: ${message}`);
    }
  }

  updateSessionStatus(sessionId, "completed", {
    completedAt: new Date(),
    errorMessage: null,
  });
  log(
    options?.revertChanges
      ? "Session ended by user; uncommitted workspace changes were reverted."
      : "Session ended by user.",
  );
  activeAgentProjects.delete(session.projectId);
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (session.status === "idle" || TERMINAL_STATUSES.includes(session.status)) {
    return;
  }

  cancelledSessions.add(sessionId);
  cancelDeploymentPoll(sessionId);
  const proc = activeAgentProcesses.get(sessionId);
  if (proc) {
    terminateAgentProcess(proc);
    activeAgentProcesses.delete(sessionId);
  }

  appendSessionLog(sessionId, "Session cancelled by user.");
  updateSessionStatus(sessionId, "cancelled", { completedAt: new Date() });
  activeAgentProjects.delete(session.projectId);
}

export function listAgentSessions(projectId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.projectId, projectId))
    .orderBy(desc(agentSessions.startedAt))
    .all();
}

export function listAgentSessionsForClient(projectId: string) {
  return listAgentSessions(projectId).map((session) => {
    const reconciled = reconcileStuckAgentSession(session.id) ?? session;
    return withClientFields(reconciled);
  });
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
