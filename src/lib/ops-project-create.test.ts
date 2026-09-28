import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import {
  agentSessions,
  functionalUsers,
  gitRepositories,
  projectForgefiles,
  projects,
} from "@/lib/db/schema";
import { createFunctionalUser } from "@/lib/functional-users";
import { mintSessionOpsToken } from "@/lib/ops-api-auth";
import {
  createProjectViaOps,
  resolveOpsProjectCreateMode,
} from "@/lib/ops-project-create";
import { POST as createProject } from "@/app/api/ops/projects/route";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";
import { getForgeAgentTool } from "@/lib/forge-agent/registry";

describe("resolveOpsProjectCreateMode", () => {
  it("defaults create from name and import from githubRepo", () => {
    expect(resolveOpsProjectCreateMode({ name: "Demo" })).toBe("create");
    expect(resolveOpsProjectCreateMode({ githubRepo: "acme/app" })).toBe("import");
    expect(resolveOpsProjectCreateMode({ mode: "local", name: "Demo" })).toBe(
      "create",
    );
    expect(() => resolveOpsProjectCreateMode({ mode: "image" })).toThrow(
      /dashboard-only/,
    );
  });
});

describe("createProjectViaOps", () => {
  let gitRoot: string;
  let reposRoot: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  const created: Array<{ projectId: string; repositoryId: string }> = [];

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), "forge-ops-create-"));
    reposRoot = mkdtempSync(join(tmpdir(), "forge-ops-repos-"));
    prevGit = process.env.FORGE_GIT_DIR;
    prevRepos = process.env.FORGE_REPOS_DIR;
    process.env.FORGE_GIT_DIR = gitRoot;
    process.env.FORGE_REPOS_DIR = reposRoot;
  });

  afterEach(() => {
    for (const row of created.splice(0)) {
      db.delete(projects).where(eq(projects.id, row.projectId)).run();
      db.delete(gitRepositories).where(eq(gitRepositories.id, row.repositoryId)).run();
    }
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
    else process.env.FORGE_REPOS_DIR = prevRepos;
    rmSync(gitRoot, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  it("creates a seeded Forge repo without a clone token in the result", async () => {
    const unique = `ops-create-${Date.now()}`;
    const result = await createProjectViaOps({ name: unique, slug: unique });
    created.push(result);
    expect(result.mode).toBe("create");
    expect(result.gitSlug).toBe(unique);
    expect(result.gitEmpty).toBe(false);
    expect(result.httpsCloneUrl).toContain(`/api/git/${unique}.git`);
    expect(result.importedFrom).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/fgc\./);
    expect(existsSync(join(gitRoot, `${unique}.git`))).toBe(true);
  });

  it("imports from a local GitHub stand-in", async () => {
    const standIn = mkdtempSync(join(tmpdir(), "gh-ops-standin-"));
    const seed = mkdtempSync(join(tmpdir(), "gh-ops-seed-"));
    try {
      execFileSync("git", ["init", "--bare", standIn], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      execFileSync("git", ["clone", standIn, seed], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      writeFileSync(join(seed, "README.md"), "# imported\n");
      const gitIdent = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      };
      execFileSync("git", ["add", "README.md"], { cwd: seed, env: gitIdent });
      execFileSync("git", ["commit", "-m", "init"], { cwd: seed, env: gitIdent });
      execFileSync("git", ["push", "origin", "HEAD:main"], {
        cwd: seed,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });

      const unique = `ops-import-${Date.now()}`;
      const result = await createProjectViaOps({
        mode: "import",
        githubRepo: `acme/${unique}`,
        name: unique,
        slug: unique,
        branch: "main",
        sourceUrl: standIn,
      });
      created.push(result);
      expect(result.mode).toBe("import");
      expect(result.importedFrom).toBe(`acme/${unique}`);
      expect(result.gitEmpty).toBe(false);
    } finally {
      rmSync(standIn, { recursive: true, force: true });
      rmSync(seed, { recursive: true, force: true });
    }
  });
});

describe("POST /api/ops/projects", () => {
  let gitRoot: string;
  let reposRoot: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  let prevToken: string | undefined;
  let prevSecret: string | undefined;
  const created: Array<{ projectId: string; repositoryId: string }> = [];

  beforeEach(() => {
    gitRoot = mkdtempSync(join(tmpdir(), "forge-ops-http-"));
    reposRoot = mkdtempSync(join(tmpdir(), "forge-ops-http-repos-"));
    prevGit = process.env.FORGE_GIT_DIR;
    prevRepos = process.env.FORGE_REPOS_DIR;
    prevToken = process.env.FORGE_OPS_API_TOKEN;
    prevSecret = process.env.FORGE_OPS_SESSION_SECRET;
    process.env.FORGE_GIT_DIR = gitRoot;
    process.env.FORGE_REPOS_DIR = reposRoot;
    process.env.FORGE_OPS_SESSION_SECRET = "test-ops-create-secret";
    delete process.env.FORGE_OPS_API_TOKEN;
  });

  afterEach(() => {
    for (const row of created.splice(0)) {
      db.delete(projects).where(eq(projects.id, row.projectId)).run();
      db.delete(gitRepositories).where(eq(gitRepositories.id, row.repositoryId)).run();
    }
    db.delete(functionalUsers).where(eq(functionalUsers.name, "ops-create-mcp")).run();
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
    else process.env.FORGE_REPOS_DIR = prevRepos;
    if (prevToken === undefined) delete process.env.FORGE_OPS_API_TOKEN;
    else process.env.FORGE_OPS_API_TOKEN = prevToken;
    if (prevSecret === undefined) delete process.env.FORGE_OPS_SESSION_SECRET;
    else process.env.FORGE_OPS_SESSION_SECRET = prevSecret;
    rmSync(gitRoot, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  it("rejects missing auth, session tokens, and missing actionDescription", async () => {
    const unauth = await createProject(
      new Request("http://127.0.0.1/api/ops/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionDescription: "Creating a repo from an unauthenticated caller.",
          name: "nope",
        }),
      }),
    );
    expect(unauth.status).toBe(401);

    const projectId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();
    db.insert(projects)
      .values({
        id: projectId,
        name: "Session Create Guard",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/session-create-guard",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
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
    db.insert(projectForgefiles)
      .values({
        projectId,
        status: "valid",
        parsedJson: '{"version":1}',
        updatedAt: now,
      })
      .run();
    try {
      const fos = mintSessionOpsToken(sessionId, projectId);
      const sessionDenied = await createProject(
        new Request("http://127.0.0.1/api/ops/projects", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${fos}`,
          },
          body: JSON.stringify({
            actionDescription: "Session token attempting fleet-wide repo create.",
            name: "should-fail",
          }),
        }),
      );
      expect(sessionDenied.status).toBe(403);
      const sessionBody = (await sessionDenied.json()) as { error: string };
      expect(sessionBody.error).toMatch(/session tokens cannot create/i);
    } finally {
      db.delete(projectForgefiles).where(eq(projectForgefiles.projectId, projectId)).run();
      db.delete(agentSessions).where(eq(agentSessions.id, sessionId)).run();
      db.delete(projects).where(eq(projects.id, projectId)).run();
    }

    const createdUser = createFunctionalUser("ops-create-mcp");
    const missingDesc = await createProject(
      new Request("http://127.0.0.1/api/ops/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${createdUser.token}`,
        },
        body: JSON.stringify({ name: "missing-desc" }),
      }),
    );
    expect(missingDesc.status).toBe(400);
  });

  it("creates a seeded repo with an fmu token and audits the actor", async () => {
    const createdUser = createFunctionalUser("ops-create-mcp");
    const unique = `fmu-create-${Date.now()}`;
    const response = await createProject(
      new Request("http://127.0.0.1/api/ops/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${createdUser.token}`,
        },
        body: JSON.stringify({
          actionDescription:
            "Creating a seeded Forge repo from an authenticated MCP functional user.",
          name: unique,
          slug: unique,
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      ok: boolean;
      opsActionId: string;
      projectId: string;
      repositoryId: string;
      gitSlug: string;
      gitCloneToken?: string;
    };
    created.push({ projectId: body.projectId, repositoryId: body.repositoryId });
    expect(body.ok).toBe(true);
    expect(body.gitSlug).toBe(unique);
    expect(body.opsActionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.gitCloneToken).toBeUndefined();
  });

  it("lists create in the catalog and MCP tool registry", () => {
    const catalog = forgeOpsApiCatalog("http://example.test");
    const create = catalog.endpoints.find(
      (item) => item.method === "POST" && item.path === "/api/ops/projects",
    );
    expect(create?.body).toMatchObject({
      actionDescription: "string (required)",
    });
    const tool = getForgeAgentTool("ops.projects.create");
    expect(tool?.callable).toBe(true);
    expect(tool?.path).toBe("/api/ops/projects");
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining(["actionDescription"]),
    );
    expect(getForgeAgentTool("dashboard.projects.create")?.callable).toBe(false);
  });
});
