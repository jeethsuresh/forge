import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  artifacts,
  deployTargets,
  deployments,
  gitRepositories,
  gitSshKeys,
  projectForgefiles,
  projects,
  secrets,
} from "@/lib/db/schema";
import { decryptSecretValue, storeSecret } from "@/lib/agent-secrets";
import { shouldSkipBaselineAutoDeploy } from "@/lib/deployer";
import { barePathForSlug } from "@/lib/git-paths";
import { addGitSshKey } from "@/lib/git-ssh";
import {
  applyMigrationManifest,
  createRepositoryBundle,
  migrationConflicts,
} from "@/lib/migration/apply";
import {
  buildMigrationManifest,
  parseMigrationManifest,
} from "@/lib/migration/manifest";
import {
  applyMigrationPreview,
  parseMigrationBaseUrl,
  previewMigration,
} from "@/lib/migration/pull";
import type { MigrationManifest } from "@/lib/migration/manifest";

const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Forge Test",
  GIT_AUTHOR_EMAIL: "forge@test",
  GIT_COMMITTER_NAME: "Forge Test",
  GIT_COMMITTER_EMAIL: "forge@test",
};

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv,
  });
}

function seedBareRepo(root: string): { barePath: string; mainSha: string } {
  const barePath = join(root, "source.git");
  const work = join(root, "work");
  git(["init", "--bare", barePath]);
  git(["clone", barePath, work]);
  git(["checkout", "-B", "main"], work);
  writeFileSync(join(work, "README.md"), "hello\n");
  git(["add", "-A"], work);
  git(["commit", "-m", "init"], work);
  git(["push", "origin", "HEAD:main"], work);
  git(["checkout", "-B", "feature"], work);
  writeFileSync(join(work, "feature.txt"), "feature\n");
  git(["add", "-A"], work);
  git(["commit", "-m", "feature"], work);
  git(["push", "origin", "HEAD:feature"], work);
  const mainSha = git(["rev-parse", "refs/heads/main"], barePath).trim();
  return { barePath, mainSha };
}

describe("shouldSkipBaselineAutoDeploy", () => {
  it("skips a seen tip that has never been deployed", () => {
    expect(shouldSkipBaselineAutoDeploy("abc", "abc", false)).toBe(true);
  });

  it("still retries when a deployment row exists", () => {
    expect(shouldSkipBaselineAutoDeploy("abc", "abc", true)).toBe(false);
  });

  it("does not skip a new commit", () => {
    expect(shouldSkipBaselineAutoDeploy("abc", "def", false)).toBe(false);
    expect(shouldSkipBaselineAutoDeploy(null, "def", false)).toBe(false);
  });
});

describe("migration", () => {
  let root: string;
  let prevGit: string | undefined;
  let prevRepos: string | undefined;
  let prevSsh: string | undefined;
  const projectIds: string[] = [];
  const repoIds: string[] = [];
  const sshIds: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "forge-migrate-"));
    prevGit = process.env.FORGE_GIT_DIR;
    prevRepos = process.env.FORGE_REPOS_DIR;
    prevSsh = process.env.FORGE_GIT_SSH_DIR;
    process.env.FORGE_GIT_DIR = join(root, "git");
    process.env.FORGE_REPOS_DIR = join(root, "repos");
    process.env.FORGE_GIT_SSH_DIR = join(root, "ssh");
  });

  afterEach(() => {
    for (const id of projectIds.splice(0)) {
      db.delete(projects).where(eq(projects.id, id)).run();
    }
    for (const id of repoIds.splice(0)) {
      db.delete(gitRepositories).where(eq(gitRepositories.id, id)).run();
    }
    for (const id of sshIds.splice(0)) {
      db.delete(gitSshKeys).where(eq(gitSshKeys.id, id)).run();
    }
    if (prevGit === undefined) delete process.env.FORGE_GIT_DIR;
    else process.env.FORGE_GIT_DIR = prevGit;
    if (prevRepos === undefined) delete process.env.FORGE_REPOS_DIR;
    else process.env.FORGE_REPOS_DIR = prevRepos;
    if (prevSsh === undefined) delete process.env.FORGE_GIT_SSH_DIR;
    else process.env.FORGE_GIT_SSH_DIR = prevSsh;
    rmSync(root, { recursive: true, force: true });
  });

  function insertSource(): { projectId: string; slug: string; mainSha: string } {
    const slug = `mig-${randomUUID().slice(0, 8)}`;
    const { barePath, mainSha } = seedBareRepo(root);
    const repoId = randomUUID();
    const projectId = randomUUID();
    const now = new Date();
    repoIds.push(repoId);
    projectIds.push(projectId);
    db.insert(gitRepositories)
      .values({
        id: repoId,
        slug,
        barePath,
        defaultBranch: "main",
        importedFrom: "acme/widget",
        cloneToken: "fgc.source.should-not-export",
        createdAt: now,
      })
      .run();
    db.insert(projects)
      .values({
        id: projectId,
        name: `Widget ${slug}`,
        githubRepo: "acme/widget",
        branch: "main",
        clonePath: join(root, "old-checkout"),
        lastSeenCommit: "old",
        enabled: false,
        deployEnvJson: JSON.stringify([{ key: "REGION", value: "us" }]),
        hostPort: 4123,
        caddyRouteJson: JSON.stringify({ marker: "CADDY-SHOULD-NOT-EXPORT" }),
        gitRepositoryId: repoId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(projectForgefiles)
      .values({
        projectId,
        status: "valid",
        contentHash: "hash",
        sourcePath: "Forgefile",
        commitSha: mainSha,
        errorMessage: null,
        parsedJson: "{\"project\":{\"name\":\"Widget\"}}",
        updatedAt: now,
      })
      .run();
    db.insert(deployTargets)
      .values({
        id: randomUUID(),
        projectId,
        name: "web",
        description: "site",
        autoDeploy: true,
        subdomain: "widget",
        composeSlug: slug,
        portsJson: "[]",
        scriptsJson: "{}",
        updatedAt: now,
      })
      .run();
    db.insert(artifacts)
      .values({
        id: randomUUID(),
        projectId,
        name: "tarball",
        description: null,
        buildCommand: "make pack",
        outputPath: "dist/app.tar",
        contentType: "application/gzip",
        updatedAt: now,
      })
      .run();
    storeSecret({
      scope: "project",
      projectId,
      name: "NPM_TOKEN",
      value: "npm-secret",
    });
    storeSecret({
      scope: "global",
      name: `GLOBAL_${slug}`,
      value: "global-secret",
    });
    db.insert(agentSessions)
      .values({
        id: randomUUID(),
        projectId,
        branch: "agent/local",
        status: "completed",
        initialPrompt: "AGENT-SHOULD-NOT-EXPORT",
        source: "manual",
        logs: "",
        startedAt: now,
      })
      .run();
    db.insert(deployments)
      .values({
        id: randomUUID(),
        projectId,
        commitSha: mainSha,
        branch: "main",
        status: "success",
        trigger: "manual",
        logs: "DEPLOY-HISTORY-SHOULD-NOT-EXPORT",
        errorMessage: null,
        startedAt: now,
      })
      .run();
    const key = addGitSshKey({
      name: `laptop-${slug}`,
      publicKey: publicKey(),
      scope: "user",
    });
    sshIds.push(key.id);
    return { projectId, slug, mainSha };
  }

  let cachedPublicKey = "";
  function publicKey(): string {
    if (!cachedPublicKey) {
      const keyPath = join(root, "id_ed25519");
      execFileSync("ssh-keygen", [
        "-t",
        "ed25519",
        "-f",
        keyPath,
        "-N",
        "",
        "-C",
        "migrate-test",
      ]);
      cachedPublicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
    }
    return cachedPublicKey;
  }

  it("exports project configuration and omits agents, caddy, history, and clone tokens", () => {
    const { slug } = insertSource();
    const manifest = buildMigrationManifest();
    const project = manifest.projects.find((row) => row.git?.slug === slug);
    expect(project).toBeTruthy();
    expect(project?.enabled).toBe(false);
    expect(project?.hostPort).toBe(4123);
    expect(project?.githubRepo).toBe("acme/widget");
    expect(project?.deployEnvJson).toContain("REGION");
    expect(project?.git?.importedFrom).toBe("acme/widget");
    expect(project?.git?.hasCommits).toBe(true);
    expect(project?.forgefile?.status).toBe("valid");
    expect(project?.deployTargets[0]?.name).toBe("web");
    expect(project?.deployTargets[0]?.autoDeploy).toBe(true);
    expect(project?.artifacts[0]?.buildCommand).toBe("make pack");
    expect(project?.secrets).toEqual([{ name: "NPM_TOKEN", value: "npm-secret" }]);
    expect(manifest.globalSecrets).toContainEqual({
      name: `GLOBAL_${slug}`,
      value: "global-secret",
    });
    expect(manifest.sshKeys.some((key) => key.name === `laptop-${slug}`)).toBe(
      true,
    );
    const encoded = JSON.stringify(manifest);
    expect(encoded).not.toContain("AGENT-SHOULD-NOT-EXPORT");
    expect(encoded).not.toContain("CADDY-SHOULD-NOT-EXPORT");
    expect(encoded).not.toContain("DEPLOY-HISTORY-SHOULD-NOT-EXPORT");
    expect(encoded).not.toContain("fgc.source.should-not-export");
    expect(encoded).not.toContain("caddyRouteJson");
  });

  it("drops unknown manifest fields such as caddy and agents", () => {
    const parsed = parseMigrationManifest({
      schemaVersion: 1,
      exportedAt: "2026-09-23T00:00:00.000Z",
      projects: [
        {
          sourceId: "src",
          name: "Kept",
          githubRepo: "",
          branch: "main",
          enabled: true,
          deployEnvJson: "[]",
          hostPort: null,
          caddyRouteJson: { marker: "nope" },
          agents: [{ id: "a" }],
          git: null,
          forgefile: null,
          deployTargets: [],
          artifacts: [],
          secrets: [],
        },
      ],
      globalSecrets: [],
      sshKeys: [],
    });
    expect(parsed.projects[0]?.name).toBe("Kept");
    expect("caddyRouteJson" in (parsed.projects[0] ?? {})).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("nope");
  });

  it("rejects an unsupported schema version", () => {
    expect(() =>
      parseMigrationManifest({
        schemaVersion: 2,
        exportedAt: "2026-09-23T00:00:00.000Z",
        projects: [],
        globalSecrets: [],
        sshKeys: [],
      }),
    ).toThrow(/schema version/i);
  });

  it("imports the bare repo, one watch-branch checkout, and re-encrypted secrets", async () => {
    const { projectId, slug, mainSha } = insertSource();
    const manifest = buildMigrationManifest();
    const bundle = await createRepositoryBundle(
      db
        .select()
        .from(gitRepositories)
        .where(eq(gitRepositories.slug, slug))
        .get()!.barePath,
    );
    db.delete(projects).where(eq(projects.id, projectId)).run();
    projectIds.splice(projectIds.indexOf(projectId), 1);
    const sourceRepo = repoIds.find((id) => {
      const row = db
        .select()
        .from(gitRepositories)
        .where(eq(gitRepositories.id, id))
        .get();
      return row?.slug === slug;
    });
    if (sourceRepo) {
      db.delete(gitRepositories).where(eq(gitRepositories.id, sourceRepo)).run();
      repoIds.splice(repoIds.indexOf(sourceRepo), 1);
    }
    const sourceKey = db
      .select()
      .from(gitSshKeys)
      .all()
      .find((key) => key.name === `laptop-${slug}`);
    if (sourceKey) {
      db.delete(gitSshKeys).where(eq(gitSshKeys.id, sourceKey.id)).run();
      const index = sshIds.indexOf(sourceKey.id);
      if (index >= 0) sshIds.splice(index, 1);
    }
    db.delete(secrets)
      .where(eq(secrets.name, `GLOBAL_${slug}`))
      .run();

    const filtered = onlySlug(manifest, slug);
    const result = await applyMigrationManifest(
      filtered,
      new Map([[slug, bundle]]),
    );
    const created = result.projects[0];
    expect(created?.name).toContain("Widget");
    expect(created?.id).not.toBe(projectId);
    if (created) projectIds.push(created.id);
    const row = db
      .select()
      .from(projects)
      .where(eq(projects.id, created!.id))
      .get();
    expect(row?.caddyRouteJson).toBeNull();
    expect(row?.enabled).toBe(false);
    expect(row?.hostPort).toBe(4123);
    expect(row?.lastSeenCommit).toBe(mainSha);
    expect(row?.deployEnvJson).toContain("REGION");
    const repo = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.id, row!.gitRepositoryId!))
      .get();
    if (repo) repoIds.push(repo.id);
    expect(repo?.cloneToken?.startsWith("fgc.")).toBe(true);
    expect(repo?.cloneToken).not.toBe("fgc.source.should-not-export");
    expect(repo?.importedFrom).toBe("acme/widget");
    const refs = git(["show-ref"], repo!.barePath);
    expect(refs).toContain("refs/heads/feature");
    expect(refs).toContain("refs/heads/main");
    const locals = git(
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      row!.clonePath,
    )
      .trim()
      .split("\n");
    expect(locals).toEqual(["main"]);
    const target = db
      .select()
      .from(deployTargets)
      .where(eq(deployTargets.projectId, created!.id))
      .get();
    expect(target?.autoDeploy).toBe(true);
    const secret = db
      .select()
      .from(secrets)
      .where(eq(secrets.projectId, created!.id))
      .get();
    expect(decryptSecretValue(secret!.ciphertext)).toBe("npm-secret");
    const globalSecret = db
      .select()
      .from(secrets)
      .where(eq(secrets.name, `GLOBAL_${slug}`))
      .get();
    expect(decryptSecretValue(globalSecret!.ciphertext)).toBe("global-secret");
    expect(
      db
        .select()
        .from(deployments)
        .where(eq(deployments.projectId, created!.id))
        .all(),
    ).toEqual([]);
    expect(
      db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.projectId, created!.id))
        .all(),
    ).toEqual([]);
    const hook = readFileSync(join(repo!.barePath, "hooks", "post-receive"), "utf8");
    expect(hook).toContain("post-receive");
    const importedKey = db
      .select()
      .from(gitSshKeys)
      .all()
      .find((key) => key.name === `laptop-${slug}`);
    expect(importedKey).toBeTruthy();
    if (importedKey) sshIds.push(importedKey.id);
  });

  it("refuses a compose-slug collision before writing a bare repo", async () => {
    const { slug } = insertSource();
    const manifest = onlySlug(buildMigrationManifest(), slug);
    const bundle = await createRepositoryBundle(
      db.select().from(gitRepositories).where(eq(gitRepositories.slug, slug)).get()!
        .barePath,
    );
    expect(migrationConflicts(manifest).length).toBeGreaterThan(0);
    await expect(
      applyMigrationManifest(manifest, new Map([[slug, bundle]])),
    ).rejects.toThrow(/compose name|already exists/i);
  });

  it("removes a repo already written when a later bundle is invalid", async () => {
    const nameA = `Alpha ${randomUUID().slice(0, 8)}`;
    const nameB = `Beta ${randomUUID().slice(0, 8)}`;
    const slugA = `a-${randomUUID().slice(0, 8)}`;
    const slugB = `b-${randomUUID().slice(0, 8)}`;
    const { barePath } = seedBareRepo(join(root, "alpha"));
    const bundle = await createRepositoryBundle(barePath);
    const manifest: MigrationManifest = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      globalSecrets: [],
      sshKeys: [],
      projects: [
        projectShell(nameA, slugA),
        projectShell(nameB, slugB),
      ],
    };
    await expect(
      applyMigrationManifest(
        manifest,
        new Map<string, Buffer>([
          [slugA, bundle],
          [slugB, Buffer.from("not-a-bundle")],
        ]),
      ),
    ).rejects.toThrow();
    expect(existsSync(barePathForSlug(slugA))).toBe(false);
    expect(existsSync(barePathForSlug(slugB))).toBe(false);
    expect(
      db.select().from(projects).all().some((row) => row.name === nameA),
    ).toBe(false);
  });

  it("previews through a fake sender and imports without sending the password again", async () => {
    const { slug } = insertSource();
    const manifest = onlySlug(buildMigrationManifest(), slug);
    const bundle = await createRepositoryBundle(
      db.select().from(gitRepositories).where(eq(gitRepositories.slug, slug)).get()!
        .barePath,
    );
    const sourceProject = manifest.projects[0]!;
    db.delete(projects).where(eq(projects.id, sourceProject.sourceId)).run();
    projectIds.splice(projectIds.indexOf(sourceProject.sourceId), 1);
    const repo = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.slug, slug))
      .get();
    if (repo) {
      db.delete(gitRepositories).where(eq(gitRepositories.id, repo.id)).run();
      repoIds.splice(repoIds.indexOf(repo.id), 1);
    }
    db.delete(secrets).where(eq(secrets.name, `GLOBAL_${slug}`)).run();
    const sourceKey = db
      .select()
      .from(gitSshKeys)
      .all()
      .find((key) => key.name === `laptop-${slug}`);
    if (sourceKey) {
      db.delete(gitSshKeys).where(eq(gitSshKeys.id, sourceKey.id)).run();
      sshIds.splice(sshIds.indexOf(sourceKey.id), 1);
    }

    const calls: { url: string; cookie?: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        cookie: headers.get("cookie") ?? undefined,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/api/auth/login")) {
        return new Response(JSON.stringify({ username: "admin" }), {
          status: 200,
          headers: { "set-cookie": "forge_session=abc; Path=/; HttpOnly" },
        });
      }
      if (url.endsWith("/api/settings/migration/export")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      if (url.endsWith(`/api/settings/migration/repos/${slug}`)) {
        return new Response(new Uint8Array(bundle), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    };

    const preview = await previewMigration({
      baseUrl: "http://sender.example:3000",
      username: "admin",
      password: "secret-pass",
      fetchImpl,
    });
    expect(preview.summary.insecureHttp).toBe(true);
    expect(preview.summary.projectNames[0]).toContain("Widget");
    const applied = await applyMigrationPreview(preview.previewId, fetchImpl);
    expect(applied.projects).toHaveLength(1);
    if (applied.projects[0]) projectIds.push(applied.projects[0].id);
    const repoRow = db
      .select()
      .from(gitRepositories)
      .where(eq(gitRepositories.slug, slug))
      .get();
    if (repoRow) repoIds.push(repoRow.id);
    const key = db
      .select()
      .from(gitSshKeys)
      .all()
      .find((row) => row.name === `laptop-${slug}`);
    if (key) sshIds.push(key.id);
    const login = calls.find((call) => call.url.endsWith("/api/auth/login"));
    expect(login?.body).toContain("secret-pass");
    const bundleCall = calls.find((call) => call.url.includes("/repos/"));
    expect(bundleCall?.cookie).toBe("forge_session=abc");
    expect(bundleCall?.body ?? "").not.toContain("secret-pass");
  });

  it("stops when the sender redirects", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, { status: 302, headers: { location: "http://elsewhere" } });
    await expect(
      previewMigration({
        baseUrl: "https://forge.example",
        username: "admin",
        password: "pw",
        fetchImpl,
      }),
    ).rejects.toThrow(/redirect/i);
  });

  it("rejects a URL with a path or userinfo", () => {
    expect(() => parseMigrationBaseUrl("https://user:pw@host")).toThrow(/userinfo|username/i);
    expect(() => parseMigrationBaseUrl("https://forge.example/settings")).toThrow(/base URL/i);
    expect(parseMigrationBaseUrl("https://forge.example/").baseUrl).toBe(
      "https://forge.example",
    );
  });
});

function onlySlug(manifest: MigrationManifest, slug: string): MigrationManifest {
  return {
    ...manifest,
    projects: manifest.projects.filter((project) => project.git?.slug === slug),
    sshKeys: manifest.sshKeys.filter((key) => key.name.endsWith(slug)),
    globalSecrets: manifest.globalSecrets.filter((secret) =>
      secret.name.endsWith(slug),
    ),
  };
}

function projectShell(name: string, slug: string): MigrationManifest["projects"][number] {
  return {
    sourceId: randomUUID(),
    name,
    githubRepo: "",
    branch: "main",
    enabled: true,
    deployEnvJson: "[]",
    hostPort: null,
    git: {
      slug,
      defaultBranch: "main",
      importedFrom: null,
      hasCommits: true,
    },
    forgefile: null,
    deployTargets: [],
    artifacts: [],
    secrets: [],
  };
}
