import type { ContainerInfo } from "@/lib/docker";
import { getComposeContainerStatus } from "@/lib/docker";
import { hasRollbackImage } from "@/lib/deploy-rollback";
import type { Project } from "@/lib/db/schema";

type CacheEntry<T> = { value: T; expiresAt: number };

const containerCache = new Map<string, CacheEntry<ContainerInfo[]>>();
const rollbackCache = new Map<string, CacheEntry<boolean>>();
const remoteCommitCache = new Map<
  string,
  CacheEntry<{ sha: string | null; failed: boolean }>
>();

export function invalidateProjectRuntimeCache(projectId: string): void {
  containerCache.delete(projectId);
  rollbackCache.delete(projectId);
  for (const key of remoteCommitCache.keys()) {
    if (key.startsWith(`${projectId}:`)) {
      remoteCommitCache.delete(key);
    }
  }
}

export async function getCachedRemoteCommitSha(
  projectId: string,
  repo: string,
  branch: string,
  ttlMs: number,
  fetchRemote: () => Promise<string>,
): Promise<{ sha: string | null; failed: boolean }> {
  const key = `${projectId}:${branch}`;
  const now = Date.now();
  const cached = remoteCommitCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const sha = await fetchRemote();
    const value = { sha, failed: false };
    remoteCommitCache.set(key, { value, expiresAt: now + ttlMs });
    return value;
  } catch {
    const value = { sha: null, failed: true };
    remoteCommitCache.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }
}

export function seedComposeContainerCache(
  projectId: string,
  containers: ContainerInfo[],
  ttlMs: number,
): void {
  containerCache.set(projectId, {
    value: containers,
    expiresAt: Date.now() + ttlMs,
  });
}

export async function getCachedComposeContainerStatus(
  projectId: string,
  repoPath: string,
  composeProjectSlug: string,
  ttlMs: number,
): Promise<ContainerInfo[]> {
  const now = Date.now();
  const cached = containerCache.get(projectId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await getComposeContainerStatus(repoPath, composeProjectSlug);
  containerCache.set(projectId, { value, expiresAt: now + ttlMs });
  return value;
}

export async function getCachedRollbackAvailability(
  projectId: string,
  project: Project,
  ttlMs: number,
): Promise<boolean> {
  const now = Date.now();
  const cached = rollbackCache.get(projectId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await hasRollbackImage(project);
  rollbackCache.set(projectId, { value, expiresAt: now + ttlMs });
  return value;
}
