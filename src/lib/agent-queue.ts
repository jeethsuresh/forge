import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { activeAgentProjects, isAgentSessionActive } from "@/lib/agent-state";

export function isQueuedAgentSessionStatus(status: string): boolean {
  return status === "queued";
}

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
  return listQueuedAgentSessions(projectId)[0] ?? null;
}

export function isProjectAgentPipelineBusy(projectId: string): boolean {
  if (activeAgentProjects.has(projectId)) return true;
  return isAgentSessionActive(projectId);
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
      status: "queued",
      initialPrompt: prompt,
      errorMessage: null,
      completedAt: null,
      deploymentId: null,
      commitSha: null,
      failedTurnStartSeq: null,
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
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
  if (isProjectAgentPipelineBusy(projectId)) return;

  const next = getNextQueuedAgentSession(projectId);
  if (!next) return;

  activeAgentProjects.add(projectId);
  db.update(agentSessions)
    .set({ status: "pending", errorMessage: null, completedAt: null })
    .where(eq(agentSessions.id, next.id))
    .run();

  startTurn(next.id, projectId, next.initialPrompt);
}
