import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories, projects } from "@/lib/db/schema";
import {
  attachForgeGitToExistingProject,
  migrateGithubOriginProjects,
} from "@/lib/git-migrate-origin";
import { projectRemoteUrl, projectUsesForgeGit } from "@/lib/project-git-remote";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

describe("migrate GitHub-origin projects", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
    db.delete(projects).run();
    db.delete(gitRepositories).run();
  });

  it("attaches a Forge bare repo and sets pushDefault when origin is GitHub", async () => {
    const gitRoot = mkdtempSync(join(tmpdir(), "forge-mig-git-"));
    const source = mkdtempSync(join(tmpdir(), "forge-mig-src-"));
    const clone = mkdtempSync(join(tmpdir(), "forge-mig-clone-"));
    dirs.push(gitRoot, source, clone);
    process.env.FORGE_GIT_DIR = gitRoot;

    await git(source, ["init", "-b", "main"]);
    writeFileSync(join(source, "README.md"), "hi\n");
    await git(source, ["add", "README.md"]);
    await git(source, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);

    await git(clone, ["clone", source, "."]);
    await git(clone, ["remote", "set-url", "origin", "https://github.com/acme/widget.git"]);

    const now = new Date();
    db.insert(projects)
      .values({
        id: "proj-mig",
        name: "Widget",
        githubRepo: "acme/widget",
        branch: "main",
        clonePath: clone,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const project = db.select().from(projects).where(eq(projects.id, "proj-mig")).get()!;
    const result = await attachForgeGitToExistingProject(project, {
      sourceUrl: source,
    });
    expect(result.pushRemote).toBe("forge");

    const linked = db.select().from(projects).where(eq(projects.id, "proj-mig")).get()!;
    expect(projectUsesForgeGit(linked)).toBe(true);
    expect(projectRemoteUrl(linked)).toContain(".git");

    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get", "remote.pushDefault"],
      { cwd: clone },
    );
    expect(stdout.trim()).toBe("forge");
  });

  it("skips projects that already have a Forge repo", async () => {
    const now = new Date();
    db.insert(projects)
      .values({
        id: "already",
        name: "Already",
        githubRepo: "",
        branch: "main",
        clonePath: "/tmp/already",
        gitRepositoryId: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expect(await migrateGithubOriginProjects()).toBe(0);
  });
});
