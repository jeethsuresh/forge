import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { gitRepositories } from "@/lib/db/schema";
import {
  ensureGitCloneToken,
  isGitCloneToken,
  mintGitCloneToken,
  regenerateGitCloneToken,
} from "@/lib/git-clone-token";

describe("git clone tokens", () => {
  it("mints fgc.<id>.<secret> tokens", () => {
    const token = mintGitCloneToken("abcd1234-5678-90ab-cdef-1234567890ab");
    expect(isGitCloneToken(token)).toBe(true);
    expect(token.startsWith("fgc.")).toBe(true);
    expect(token.split(".")).toHaveLength(3);
    expect(isGitCloneToken("fos.session.mac")).toBe(false);
    expect(isGitCloneToken("global-ops")).toBe(false);
  });

  it("ensures and regenerates tokens on a repository row", () => {
    const repoId = randomUUID();
    const now = new Date();
    db.insert(gitRepositories)
      .values({
        id: repoId,
        slug: `clone-tok-${repoId.slice(0, 8)}`,
        barePath: `/tmp/forge-git-test/clone-tok-${repoId.slice(0, 8)}.git`,
        defaultBranch: "main",
        importedFrom: null,
        cloneToken: null,
        createdAt: now,
      })
      .run();

    const first = ensureGitCloneToken(repoId);
    expect(isGitCloneToken(first)).toBe(true);
    const again = ensureGitCloneToken(repoId);
    expect(again).toBe(first);

    const next = regenerateGitCloneToken(repoId);
    expect(isGitCloneToken(next)).toBe(true);
    expect(next).not.toBe(first);

    const row = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, repoId))
      .get();
    expect(row?.cloneToken).toBe(next);

    db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
  });
});
