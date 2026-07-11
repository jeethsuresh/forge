const BRANCH_CACHE_MS = 60_000;

type BranchCacheEntry = { branches: string[]; expiresAt: number };

const branchCache = new Map<string, BranchCacheEntry>();

export function getCachedProjectBranches(projectId: string): string[] | null {
  const entry = branchCache.get(projectId);
  if (!entry || entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.branches;
}

export function setCachedProjectBranches(
  projectId: string,
  branches: string[],
): void {
  branchCache.set(projectId, {
    branches,
    expiresAt: Date.now() + BRANCH_CACHE_MS,
  });
}

export function invalidateProjectBranches(projectId: string): void {
  branchCache.delete(projectId);
}
