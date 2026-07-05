import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, type AgentSessionStatus } from "@/lib/db/schema";

export const activeAgentProjects = new Set<string>();

const ACTIVE_STATUSES: AgentSessionStatus[] = [
  "pending",
  "running",
  "deploying",
];

export function isAgentSessionActive(projectId: string): boolean {
  if (activeAgentProjects.has(projectId)) return true;

  const row = db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, ACTIVE_STATUSES),
      ),
    )
    .get();

  return Boolean(row);
}

export function getActiveSessionForProject(projectId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.status, ACTIVE_STATUSES),
      ),
    )
    .orderBy(desc(agentSessions.startedAt))
    .limit(1)
    .get();
}
