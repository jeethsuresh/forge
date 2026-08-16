import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories } from "@/lib/db/schema";

const CLONE_TOKEN_PREFIX = "fgc";

export function isGitCloneToken(token: string | null | undefined): boolean {
  const value = token?.trim() ?? "";
  if (!value.startsWith(`${CLONE_TOKEN_PREFIX}.`)) return false;
  const parts = value.split(".");
  return parts.length === 3 && parts[1]!.length > 0 && parts[2]!.length > 0;
}

export function mintGitCloneToken(repositoryId: string): string {
  const shortId = repositoryId.replace(/-/g, "").slice(0, 12) || "repo";
  const secret = randomBytes(24).toString("base64url");
  return `${CLONE_TOKEN_PREFIX}.${shortId}.${secret}`;
}

export function ensureGitCloneToken(repositoryId: string): string {
  const repo = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.id, repositoryId))
    .get();
  if (!repo) {
    throw new Error(`Unknown git repository: ${repositoryId}`);
  }
  if (repo.cloneToken && isGitCloneToken(repo.cloneToken)) {
    return repo.cloneToken;
  }
  const token = mintGitCloneToken(repositoryId);
  db.update(gitRepositories)
    .set({ cloneToken: token })
    .where(eq(gitRepositories.id, repositoryId))
    .run();
  return token;
}

export function regenerateGitCloneToken(repositoryId: string): string {
  const repo = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.id, repositoryId))
    .get();
  if (!repo) {
    throw new Error(`Unknown git repository: ${repositoryId}`);
  }
  const token = mintGitCloneToken(repositoryId);
  db.update(gitRepositories)
    .set({ cloneToken: token })
    .where(eq(gitRepositories.id, repositoryId))
    .run();
  return token;
}
