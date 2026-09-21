import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import {
  isAgentSessionActiveOnBranch,
  markAgentSessionLive,
} from "@/lib/agent-state";
import { transition } from "@/lib/agent-session-machine";
import { isQueuedAgentSessionStatus } from "@/lib/agent-session-source";

export { isQueuedAgentSessionStatus };

export function listQueuedAgentSessions(projectId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.status, "queued"),
      ),
    )
    .all()
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

export function getNextQueuedAgentSession(projectId: string) {
  return (
    listQueuedAgentSessions(projectId).find(
      (session) => !isAgentSessionActiveOnBranch(projectId, session.branch),
    ) ?? null
  );
}

export function isProjectAgentPipelineBusy(projectId: string): boolean {
  return listQueuedAgentSessions(projectId).every((session) =>
    isAgentSessionActiveOnBranch(projectId, session.branch),
  ) && listQueuedAgentSessions(projectId).length > 0;
}

export function countQueuedAgentSessions(projectId: string): number {
  return db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.status, "queued"),
      ),
    )
    .all().length;
}

export function markAgentSessionQueued(sessionId: string, prompt: string): void {
  db.update(agentSessions)
    .set({
      initialPrompt: prompt,
      errorMessage: null,
      completedAt: null,
      deploymentId: null,
      commitSha: null,
      failedTurnStartSeq: null,
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
  transition(sessionId, { type: "queue" });
}

export type StartQueuedAgentTurn = (
  sessionId: string,
  projectId: string,
  prompt: string,
) => void;

export function processAgentQueue(
  projectId: string,
  startTurn: StartQueuedAgentTurn,
): void {
  for (const next of listQueuedAgentSessions(projectId)) {
    if (isAgentSessionActiveOnBranch(projectId, next.branch)) continue;
    markAgentSessionLive(next.id, projectId);
    transition(next.id, { type: "start" });
    startTurn(next.id, projectId, next.initialPrompt);
  }
}
