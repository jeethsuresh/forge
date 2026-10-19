/** Branches with an active agent session (excludes checkout-only containers). */
export function filterLiveBranchesWithAgents<
  T extends { sessionId: string | null },
>(branches: T[]): T[] {
  return branches.filter((b) => b.sessionId != null);
}
