import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureForgeBareOrigin,
  isForgeHttpGitUrl,
} from "@/lib/forge-git-origin";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

describe("forge git origin", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("recognizes unauthenticated Forge HTTP git URLs", () => {
    expect(isForgeHttpGitUrl("http://127.0.0.1:3000/api/git/shatterfield.git")).toBe(
      true,
    );
    expect(
      isForgeHttpGitUrl("http://git:fgc.secret@127.0.0.1:3000/api/git/shatterfield.git"),
    ).toBe(false);
    expect(isForgeHttpGitUrl("/data/git/shatterfield.git")).toBe(false);
  });

  it("rewrites an HTTP Forge origin to the local bare repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-origin-"));
    dirs.push(root);
    const bare = join(root, "repo.git");
    const work = join(root, "work");
    await git(root, ["init", "--bare", bare]);
    await git(root, ["clone", bare, work]);
    await git(work, [
      "remote",
      "set-url",
      "origin",
      "http://127.0.0.1:3000/api/git/demo.git",
    ]);

    await ensureForgeBareOrigin(work, bare);
    expect(await git(work, ["remote", "get-url", "origin"])).toBe(bare);
  });

  it("leaves a non-Forge remote alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-origin-"));
    dirs.push(root);
    const bare = join(root, "repo.git");
    const work = join(root, "work");
    const other = join(root, "other.git");
    await git(root, ["init", "--bare", bare]);
    await git(root, ["init", "--bare", other]);
    await git(root, ["clone", other, work]);

    await ensureForgeBareOrigin(work, bare);
    expect(await git(work, ["remote", "get-url", "origin"])).toBe(other);
  });
});
