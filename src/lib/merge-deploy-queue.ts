import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  deployments,
  forgeUpdates,
  mergeDeployJobs,
  projects,
  type MergeDeployJob,
  type MergeDeployJobStatus,
} from "@/lib/db/schema";
import {
  mergeProjectBranch,
  readBranchTipSha,
  rebaseProjectBranch,
  resetWatchBranchToSha,
} from "@/lib/project-git-tree";
import { pauseBranchWorkspace, resumeBranchWorkspace } from "@/lib/branch-workspace";
import {
  removeAgentContainer,
  stopAgentContainer,
} from "@/lib/agent-container";
import { markAgentSessionIdle } from "@/lib/agent-state";
import { transition } from "@/lib/agent-session-machine";
import {
  isForgeUpdateSuccessful,
  isForgeUpdateTerminalStatus,
} from "@/lib/ops-session-deploy";

const OPEN_JOB_STATUSES: MergeDeployJobStatus[] = ["queued", "processing"];

const inflightByProject = new Map<string, Promise<void>>();

export type MergeDeployFailureKind = "rebase" | "merge" | "deploy";

export type MergeDeployQueueHarness = {
  deployWatch?: (input: {
    projectId: string;
    branch: string;
  }) => Promise<{ ok: boolean; deploymentId?: string; errorMessage?: string }>;
  sleepAgent?: (sessionId: string, projectId: string, branch: string) => Promise<void>;
  completeSucceededAgent?: (input: {
    projectId: string;
    sessionId: string;
    branch: string;
  }) => Promise<void>;
  wakeFailedAgent?: (input: {
    sessionId: string;
    projectId: string;
    branch: string;
    errorMessage: string;
    kind: MergeDeployFailureKind;
  }) => Promise<void>;
};

let harness: MergeDeployQueueHarness | null = null;

export function setMergeDeployQueueHarness(
  next: MergeDeployQueueHarness | null,
): void {
  harness = next;
}

function appendSessionLog(sessionId: string, message: string): void {
  const row = db
    .select({ logs: agentSessions.logs })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  db.update(agentSessions)
    .set({ logs: `${row?.logs ?? ""}${line}` })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

function jobError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isMergeDeployQueueProcessing(projectId: string): boolean {
  const row = db
    .select({ id: mergeDeployJobs.id })
    .from(mergeDeployJobs)
    .where(
      and(
        eq(mergeDeployJobs.projectId, projectId),
        eq(mergeDeployJobs.status, "processing"),
      ),
    )
    .get();
  return Boolean(row);
}

export function listOpenMergeDeployJobs(projectId: string): MergeDeployJob[] {
  return db
    .select()
    .from(mergeDeployJobs)
    .where(
      and(
        eq(mergeDeployJobs.projectId, projectId),
        inArray(mergeDeployJobs.status, OPEN_JOB_STATUSES),
      ),
    )
    .orderBy(asc(mergeDeployJobs.enqueuedAt))
    .all();
}

export function getMergeQueuePosition(sessionId: string): number | null {
  const job = db
    .select()
    .from(mergeDeployJobs)
    .where(
      and(
        eq(mergeDeployJobs.sessionId, sessionId),
        inArray(mergeDeployJobs.status, OPEN_JOB_STATUSES),
      ),
    )
    .orderBy(asc(mergeDeployJobs.enqueuedAt))
    .get();
  if (!job) return null;
  const open = listOpenMergeDeployJobs(job.projectId);
  const index = open.findIndex((row) => row.id === job.id);
  return index >= 0 ? index + 1 : null;
}

export function listMergeDeployJobsForProject(projectId: string): MergeDeployJob[] {
  return db
    .select()
    .from(mergeDeployJobs)
    .where(eq(mergeDeployJobs.projectId, projectId))
    .orderBy(asc(mergeDeployJobs.enqueuedAt))
    .all();
}

function findOpenJobForSession(sessionId: string): MergeDeployJob | undefined {
  return db
    .select()
    .from(mergeDeployJobs)
    .where(
      and(
        eq(mergeDeployJobs.sessionId, sessionId),
        inArray(mergeDeployJobs.status, OPEN_JOB_STATUSES),
      ),
    )
    .get();
}

export function cancelQueuedMergeDeployJobsForSession(sessionId: string): void {
  const now = new Date();
  db.update(mergeDeployJobs)
    .set({
      status: "cancelled",
      completedAt: now,
      errorMessage: "Cancelled because the agent session ended",
    })
    .where(
      and(
        eq(mergeDeployJobs.sessionId, sessionId),
        eq(mergeDeployJobs.status, "queued"),
      ),
    )
    .run();
}

function markJob(
  jobId: string,
  patch: Partial<{
    status: MergeDeployJobStatus;
    preMergeSha: string | null;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>,
): void {
  db.update(mergeDeployJobs).set(patch).where(eq(mergeDeployJobs.id, jobId)).run();
}

async function sleepAgentForQueue(
  sessionId: string,
  projectId: string,
  branch: string,
): Promise<void> {
  if (harness?.sleepAgent) {
    await harness.sleepAgent(sessionId, projectId, branch);
    return;
  }

  try {
    await stopAgentContainer(sessionId);
  } catch {
    // already stopped
  }
  try {
    await removeAgentContainer(sessionId);
  } catch {
    // already removed
  }
  await pauseBranchWorkspace(projectId, branch);
  transition(sessionId, { type: "sleep" });
  markAgentSessionIdle(sessionId, projectId);
  appendSessionLog(sessionId, "Sleeping until the merge-and-deploy queue processes this branch.");
}

async function completeSucceededAgent(input: {
  projectId: string;
  sessionId: string;
  branch: string;
}): Promise<void> {
  if (harness?.completeSucceededAgent) {
    await harness.completeSucceededAgent(input);
    return;
  }
  transition(input.sessionId, { type: "deploy_ok" });
  markAgentSessionIdle(input.sessionId, input.projectId);
  const { endAgentAndDestroyBranchWorkspace } = await import(
    "@/lib/agent-session-lifecycle"
  );
  await endAgentAndDestroyBranchWorkspace(
    input.projectId,
    input.branch,
    "branch_merged",
  );
}

async function wakeFailedAgent(input: {
  sessionId: string;
  projectId: string;
  branch: string;
  errorMessage: string;
  kind: MergeDeployFailureKind;
}): Promise<void> {
  if (harness?.wakeFailedAgent) {
    await harness.wakeFailedAgent(input);
    return;
  }

  appendSessionLog(input.sessionId, input.errorMessage);
  transition(input.sessionId, {
    type: "fail",
    errorMessage: input.errorMessage,
  });
  markAgentSessionIdle(input.sessionId, input.projectId);
  await resumeBranchWorkspace(input.projectId, input.branch);
  const { restartAgentSession } = await import("@/lib/agent-session-lifecycle");
  await restartAgentSession(input.sessionId);
}

async function waitForDeploymentResult(
  deploymentId: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
  for (let i = 0; i < 720; i += 1) {
    const update = db
      .select()
      .from(forgeUpdates)
      .where(eq(forgeUpdates.id, deploymentId))
      .get();
    if (update?.completedAt && isForgeUpdateTerminalStatus(update.status)) {
      return {
        ok: isForgeUpdateSuccessful(update.status),
        errorMessage: update.errorMessage ?? undefined,
      };
    }
    const dep = db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .get();
    if (dep?.completedAt) {
      return {
        ok: dep.status === "success",
        errorMessage: dep.errorMessage ?? undefined,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, errorMessage: "Timed out waiting for watch-branch deploy" };
}

async function deployWatchBranch(input: {
  projectId: string;
  branch: string;
}): Promise<{ ok: boolean; errorMessage?: string }> {
  if (harness?.deployWatch) {
    return harness.deployWatch(input);
  }
  const { deployProject } = await import("@/lib/project-deploy");
  try {
    const result = await deployProject({
      projectId: input.projectId,
      branch: input.branch,
      trigger: "agent",
      fromMergeQueue: true,
    });
    return waitForDeploymentResult(result.deploymentId);
  } catch (err) {
    return { ok: false, errorMessage: jobError(err) };
  }
}

export async function enqueueMergeDeployJob(
  sessionId: string,
  options?: { drain?: boolean },
): Promise<string> {
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
  if (!session) throw new Error("Session not found");
  if (session.archivedAt) {
    throw new Error("Archived sessions cannot join the merge queue");
  }

  const existing = findOpenJobForSession(sessionId);
  if (existing) {
    if (session.status !== "sleeping") {
      await sleepAgentForQueue(sessionId, session.projectId, session.branch);
    }
    if (options?.drain !== false) {
      void processMergeDeployQueue(session.projectId);
    }
    return existing.id;
  }

  const jobId = randomUUID();
  db.insert(mergeDeployJobs)
    .values({
      id: jobId,
      projectId: session.projectId,
      sessionId,
      branch: session.branch,
      status: "queued",
      enqueuedAt: new Date(),
    })
    .run();

  appendSessionLog(
    sessionId,
    "Enqueued for merge-and-deploy. The agent will sleep until this job runs.",
  );
  await sleepAgentForQueue(sessionId, session.projectId, session.branch);

  if (options?.drain !== false) {
    void processMergeDeployQueue(session.projectId);
  }
  return jobId;
}

async function processOneJob(job: MergeDeployJob): Promise<void> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, job.projectId))
    .get();
  if (!project) {
    markJob(job.id, {
      status: "failed",
      errorMessage: "Project not found",
      completedAt: new Date(),
    });
    return;
  }

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, job.sessionId))
    .get();
  if (!session || session.archivedAt) {
    markJob(job.id, {
      status: "cancelled",
      errorMessage: "Session is no longer available",
      completedAt: new Date(),
    });
    return;
  }

  markJob(job.id, { status: "processing", startedAt: new Date() });
  const log = (line: string) => appendSessionLog(job.sessionId, line);
  const watchBranch = project.branch;
  let preMergeSha: string | null = null;
  let postMergeSha: string | null = null;
  let failureKind: MergeDeployFailureKind = "rebase";

  try {
    if (job.branch !== watchBranch) {
      failureKind = "rebase";
      log(`Rebasing ${job.branch} onto ${watchBranch} (replay commits, no reset)…`);
      await rebaseProjectBranch(project.clonePath, job.branch, watchBranch, log);
      failureKind = "merge";
      preMergeSha = await readBranchTipSha(project.clonePath, watchBranch);
      markJob(job.id, { preMergeSha });
      log(`Merging ${job.branch} into ${watchBranch}…`);
      await mergeProjectBranch(
        project.clonePath,
        job.branch,
        watchBranch,
        { watchBranch },
        log,
      );
      postMergeSha = await readBranchTipSha(project.clonePath, watchBranch);
    } else {
      preMergeSha = await readBranchTipSha(project.clonePath, watchBranch);
      markJob(job.id, { preMergeSha });
      postMergeSha = preMergeSha;
    }

    failureKind = "deploy";
    log(`Deploying watch branch ${watchBranch}…`);
    const deploy = await deployWatchBranch({
      projectId: project.id,
      branch: watchBranch,
    });
    if (!deploy.ok) {
      const deployError = deploy.errorMessage ?? "Watch-branch deploy failed";
      const watchHead = await readBranchTipSha(project.clonePath, watchBranch);
      if (preMergeSha && postMergeSha && watchHead === postMergeSha) {
        log(`Deploy failed; rolling ${watchBranch} back to ${preMergeSha.slice(0, 7)}.`);
        await resetWatchBranchToSha(
          project.clonePath,
          watchBranch,
          preMergeSha,
          log,
        );
      } else {
        log(
          "Deploy failed; watch branch HEAD changed so merge was not rolled back.",
        );
      }
      const errorMessage = `Merge rolled back after deploy failed: ${deployError}`;
      markJob(job.id, {
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      });
      await wakeFailedAgent({
        sessionId: job.sessionId,
        projectId: project.id,
        branch: job.branch,
        errorMessage,
        kind: "deploy",
      });
      return;
    }

    log(`Watch branch ${watchBranch} deployed.`);
    markJob(job.id, { status: "succeeded", completedAt: new Date() });
    await completeSucceededAgent({
      projectId: project.id,
      sessionId: job.sessionId,
      branch: job.branch,
    });
  } catch (err) {
    const errorMessage =
      failureKind === "rebase"
        ? `Rebase conflict: ${jobError(err)}`
        : failureKind === "merge"
          ? `Merge failed: ${jobError(err)}`
          : `Deploy failed: ${jobError(err)}`;
    log(errorMessage);
    markJob(job.id, {
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    });
    await wakeFailedAgent({
      sessionId: job.sessionId,
      projectId: project.id,
      branch: job.branch,
      errorMessage,
      kind: failureKind,
    });
  }
}

export async function processMergeDeployQueue(
  projectId: string,
  options?: { once?: boolean },
): Promise<void> {
  const existing = inflightByProject.get(projectId);
  if (existing) {
    await existing;
    if (options?.once) return;
  }

  const run = (async () => {
    try {
      for (;;) {
        if (isMergeDeployQueueProcessing(projectId)) return;
        const next = db
          .select()
          .from(mergeDeployJobs)
          .where(
            and(
              eq(mergeDeployJobs.projectId, projectId),
              eq(mergeDeployJobs.status, "queued"),
            ),
          )
          .orderBy(asc(mergeDeployJobs.enqueuedAt))
          .get();
        if (!next) return;
        await processOneJob(next);
        if (options?.once) return;
      }
    } catch (err) {
      console.error(
        `[forge] Merge-deploy queue failed for ${projectId}:`,
        err,
      );
    }
  })();

  inflightByProject.set(projectId, run);
  try {
    await run;
  } finally {
    if (inflightByProject.get(projectId) === run) {
      inflightByProject.delete(projectId);
    }
  }
}

export async function processAllMergeDeployQueues(): Promise<void> {
  const projectIds = new Set(
    db
      .select({ projectId: mergeDeployJobs.projectId })
      .from(mergeDeployJobs)
      .where(eq(mergeDeployJobs.status, "queued"))
      .all()
      .map((row) => row.projectId),
  );
  for (const projectId of projectIds) {
    try {
      await processMergeDeployQueue(projectId);
    } catch (err) {
      console.error(`[forge] Merge-deploy queue tick failed for ${projectId}:`, err);
    }
  }
}

declare global {
  var __forgeMergeDeployQueueStarted: boolean | undefined;
  var __forgeMergeDeployQueueTimer: ReturnType<typeof setInterval> | undefined;
}

const QUEUE_TICK_MS = 5_000;

export function startMergeDeployQueueTicker(): void {
  if (globalThis.__forgeMergeDeployQueueStarted) return;
  globalThis.__forgeMergeDeployQueueStarted = true;
  if (globalThis.__forgeMergeDeployQueueTimer) {
    clearInterval(globalThis.__forgeMergeDeployQueueTimer);
  }
  console.log("[forge] Starting merge-and-deploy queue ticker");
  const tick = () => {
    void processAllMergeDeployQueues();
  };
  void tick();
  globalThis.__forgeMergeDeployQueueTimer = setInterval(tick, QUEUE_TICK_MS);
}
