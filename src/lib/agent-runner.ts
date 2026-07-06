import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
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
import { parseStreamEventLine } from "@/lib/agent-stream";
import {
  failedTurnEventSeq,
  findFailedTurnPrompt,
  isStuckActiveSession,
} from "@/lib/agent-turn";
import { activeAgentProjects, getActiveSessionForProject, isAgentSessionActive } from "@/lib/agent-state";
import { listLocalBranches, prepareAgentWorkspace, commitAllChanges, buildAgentCommitMessage } from "@/lib/github";
import { runDeployment } from "@/lib/deployer";
import { resolveClonePath } from "@/lib/paths";

const activeAgentProcesses = new Map<string, ChildProcess>();

const TERMINAL_STATUSES: AgentSessionStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

function agentBin(): string {
  return process.env.FORGE_AGENT_BIN ?? "agent";
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
    errorMessage?: string;
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
      status: "pending",
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

export function reconcileStuckAgentSession(sessionId: string) {
  const session = getAgentSession(sessionId);
  if (!session) return undefined;

  const stuck = isStuckActiveSession({
    status: session.status,
    failedTurnStartSeq: session.failedTurnStartSeq,
    hasActiveProcess: activeAgentProcesses.has(sessionId),
    projectMarkedActive: activeAgentProjects.has(session.projectId),
  });

  if (!stuck) return session;

  const message =
    session.status === "pending"
      ? "Agent session did not start (server may have restarted)"
      : "Agent process ended unexpectedly";

  appendSessionLog(sessionId, `ERROR: ${message}`);
  updateSessionStatus(sessionId, "failed", {
    errorMessage: message,
    completedAt: new Date(),
  });
  activeAgentProjects.delete(session.projectId);
  return getAgentSession(sessionId);
}

export function getAgentSessionForClient(sessionId: string) {
  return reconcileStuckAgentSession(sessionId);
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
    const proc = spawn(agentBin(), args, {
      cwd: resolveClonePath(project.clonePath),
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

  const poll = (): void => {
    const current = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();

    if (!current?.deploymentId) return;

    const dep = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, current.deploymentId))
      .get();

    if (!dep || !dep.completedAt) {
      setTimeout(poll, 2000);
      return;
    }

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

  setTimeout(poll, 2000);
}

async function executeAgentTurn(
  sessionId: string,
  projectId: string,
  prompt: string,
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
      project.clonePath,
      session.branch,
      log,
    );

    await runAgentTurn(sessionId, project, prompt);
    updateSessionStatus(sessionId, "running");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    updateSessionStatus(sessionId, "failed", {
      errorMessage: message,
      completedAt: new Date(),
    });
    activeAgentProjects.delete(projectId);
  }
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
    if (!TERMINAL_STATUSES.includes(existing.status)) {
      await sendAgentMessage(existing.id, prompt.trim());
      return existing.id;
    }

    reactivateSession(existing.id);
    activeAgentProjects.add(projectId);
    void executeAgentTurn(existing.id, projectId, prompt.trim());
    return existing.id;
  }

  const sessionId = randomUUID();

  activeAgentProjects.add(projectId);

  db.insert(agentSessions)
    .values({
      id: sessionId,
      projectId,
      branch: trimmedBranch,
      status: "pending",
      initialPrompt: prompt.trim(),
      logs: "",
      startedAt: new Date(),
    })
    .run();

  void executeAgentTurn(sessionId, projectId, prompt.trim());

  return sessionId;
}

function assertSessionReadyForCommit(sessionId: string) {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (TERMINAL_STATUSES.includes(session.status)) {
    throw new Error("Session is no longer active");
  }
  if (activeAgentProcesses.has(sessionId)) {
    throw new Error("Agent is still processing; wait for the current turn to finish");
  }
  if (session.status === "deploying") {
    throw new Error("Deployment already in progress");
  }

  return session;
}

export async function commitAgentSessionChanges(
  sessionId: string,
  options?: { message?: string },
): Promise<{ commitSha: string | null; committed: boolean }> {
  const session = assertSessionReadyForCommit(sessionId);

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

  const message =
    options?.message?.trim() || buildAgentCommitMessage(session.initialPrompt);

  const commitSha = await commitAllChanges(
    project.clonePath,
    message,
    log,
  );

  if (commitSha) {
    db.update(agentSessions)
      .set({ commitSha })
      .where(eq(agentSessions.id, sessionId))
      .run();
  }

  return { commitSha, committed: commitSha !== null };
}

export async function finishAgentSession(sessionId: string): Promise<void> {
  const session = assertSessionReadyForCommit(sessionId);

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
    updateSessionStatus(sessionId, "running");
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

export async function cancelAgentSession(sessionId: string): Promise<void> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) throw new Error("Session not found");
  if (TERMINAL_STATUSES.includes(session.status)) return;

  const proc = activeAgentProcesses.get(sessionId);
  if (proc) {
    proc.kill("SIGTERM");
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
  return listAgentSessions(projectId).map(
    (session) => reconcileStuckAgentSession(session.id) ?? session,
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
