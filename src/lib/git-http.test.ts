import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { agentSessions, gitRepositories, projects } from "@/lib/db/schema";
import { createForgeGitRepository } from "@/lib/git-repo";
import {
  authorizeGitHttpAccess,
  handleGitSmartHttp,
  isReceivePackService,
  normalizeGitHttpSlug,
  runGitHttpBackend,
} from "@/lib/git-http";
import { mintSessionOpsToken } from "@/lib/ops-api-auth";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
    has: () => false,
    getAll: () => [],
  }),
}));

describe("git-http helpers", () => {
  it("normalizes slug and detects receive-pack", () => {
    expect(normalizeGitHttpSlug("demo.git")).toBe("demo");
    expect(isReceivePackService("git-receive-pack", [])).toBe(true);
    expect(isReceivePackService(null, ["git-upload-pack"])).toBe(false);
    expect(isReceivePackService(null, ["git-receive-pack"])).toBe(true);
  });
});

describe("authorizeGitHttpAccess", () => {
  let gitRoot: string;
  let reposRoot: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  let prevOps: string | undefined;
  let projectId = "";
  let repoId = "";
  let slug = "";

  beforeEach(async () => {
    gitRoot = mkdtempSync(join(tmpdir(), "forge-http-auth-"));
    reposRoot = mkdtempSync(join(tmpdir(), "forge-http-repos-"));
    prevGit = process.env.FORGE_GIT_DIR;
    prevRepos = process.env.FORGE_REPOS_DIR;
    prevOps = process.env.FORGE_OPS_API_TOKEN;
    process.env.FORGE_GIT_DIR = gitRoot;
    process.env.FORGE_REPOS_DIR = reposRoot;
    process.env.FORGE_OPS_API_TOKEN = "global-ops-token-test";

    slug = `http-auth-${Date.now()}`;
    const created = await createForgeGitRepository({
      name: slug,
      slug,
    });
    projectId = created.projectId;
    repoId = created.repositoryId;
  });

  afterEach(() => {
    db.delete(projects).where(eq(projects.id, projectId)).run();
    db.delete(gitRepositories).where(eq(gitRepositories.id, repoId)).run();
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
    else process.env.FORGE_REPOS_DIR = prevRepos;
    if (prevOps === undefined) delete process.env.FORGE_OPS_API_TOKEN;
    else process.env.FORGE_OPS_API_TOKEN = prevOps;
    rmSync(gitRoot, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  it("rejects unauthenticated requests", async () => {
    const req = new Request(`http://localhost/api/git/${slug}.git/info/refs`);
    const access = await authorizeGitHttpAccess(req, slug, false);
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.status).toBe(401);
  });

  it("allows global Ops bearer token", async () => {
    const req = new Request(`http://localhost/api/git/${slug}.git/info/refs`, {
      headers: { Authorization: "Bearer global-ops-token-test" },
    });
    const access = await authorizeGitHttpAccess(req, slug, true);
    expect(access).toEqual(
      expect.objectContaining({ ok: true, actor: "ops-global" }),
    );
  });

  it("allows project-scoped session Ops token and rejects cross-project", async () => {
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        branch: "main",
        status: "running",
        initialPrompt: "test",
        source: "manual",
        logs: "",
        startedAt: now,
      })
      .run();

    const token = mintSessionOpsToken(sessionId, projectId);
    const okReq = new Request(`http://localhost/api/git/${slug}.git/info/refs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await authorizeGitHttpAccess(okReq, slug, false)).ok).toBe(true);

    const otherProject = randomUUID();
    db.insert(projects)
      .values({
        id: otherProject,
        name: `other-${otherProject.slice(0, 8)}`,
        githubRepo: "acme/other",
        branch: "main",
        clonePath: `/tmp/${otherProject}`,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const otherSession = randomUUID();
    db.insert(agentSessions)
      .values({
        id: otherSession,
        projectId: otherProject,
        branch: "main",
        status: "running",
        initialPrompt: "x",
        source: "manual",
        logs: "",
        startedAt: now,
      })
      .run();
    const badToken = mintSessionOpsToken(otherSession, otherProject);
    const badReq = new Request(`http://localhost/api/git/${slug}.git/info/refs`, {
      headers: { Authorization: `Bearer ${badToken}` },
    });
    const denied = await authorizeGitHttpAccess(badReq, slug, false);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(403);

    db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
    db.delete(agentSessions).where(eq(agentSessions.id, otherSession)).run();
    db.delete(projects).where(eq(projects.id, otherProject)).run();
  });

  it("serves info/refs through smart HTTP with Ops auth", async () => {
    const req = new Request(
      `http://localhost/api/git/${slug}.git/info/refs?service=git-upload-pack`,
      { headers: { Authorization: "Bearer global-ops-token-test" } },
    );
    const res = await handleGitSmartHttp(req, `${slug}.git`, ["info", "refs"]);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("git-upload-pack");
  });

  it("runGitHttpBackend advertises refs for a bare repo", async () => {
    const repo = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, repoId))
      .get();
    expect(repo).toBeTruthy();
    const res = await runGitHttpBackend({
      barePath: repo!.barePath,
      method: "GET",
      pathInfo: "/info/refs",
      queryString: "service=git-upload-pack",
    });
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString("utf8")).toContain("service=git-upload-pack");
  });
});
