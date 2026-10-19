/** Client-safe helpers for live agent branches. Keep this file free of Node/db imports. */

/** Branches with an active agent session (excludes checkout-only containers). */
export function filterLiveBranchesWithAgents<
  T extends { sessionId: string | null },
>(branches: T[]): T[] {
  return branches.filter((b) => b.sessionId != null);
}
