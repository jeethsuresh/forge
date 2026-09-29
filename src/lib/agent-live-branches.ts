import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branchWorkspaces,
  type AgentSessionStatus,
  type BranchWorkspaceStatus,
} from "@/lib/db/schema";
import { listActiveSessionsForProject } from "@/lib/agent-state";

export interface LiveBranchInfo {
  name: string;
  sessionId: string | null;
  sessionStatus: AgentSessionStatus | null;
  containerStatus: BranchWorkspaceStatus | null;
}

/** Branches with an active agent session (excludes checkout-only containers). */
export function filterLiveBranchesWithAgents<
  T extends { sessionId: string | null },
>(branches: T[]): T[] {
  return branches.filter((b) => b.sessionId != null);
}

export function listLiveBranches(projectId: string): LiveBranchInfo[] {
  const sessions = listActiveSessionsForProject(projectId);
  const workspaces = db
    .select()
    .from(branchWorkspaces)
    .where(eq(branchWorkspaces.projectId, projectId))
    .all();
  const byName = new Map<string, LiveBranchInfo>();

  for (const workspace of workspaces) {
    if (workspace.status === "stopped") continue;
    byName.set(workspace.branch, {
      name: workspace.branch,
      sessionId: null,
      sessionStatus: null,
      containerStatus: workspace.status,
    });
  }

  for (const session of sessions) {
    const current = byName.get(session.branch) ?? {
      name: session.branch,
      sessionId: null,
      sessionStatus: null,
      containerStatus: null,
    };
    current.sessionId = session.id;
    current.sessionStatus = session.status;
    byName.set(session.branch, current);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
