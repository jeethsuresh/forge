import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import {
  assertAbsoluteHostDirectory,
  copyHostDirectorySkippingGit,
  importHostDirectoryToRepo,
} from "./git-import-host-path";

function git(args: string[], cwd: string) {
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Forge",
      GIT_AUTHOR_EMAIL: "forge@localhost",
      GIT_COMMITTER_NAME: "Forge",
      GIT_COMMITTER_EMAIL: "forge@localhost",
    },
  });
}

describe("assertAbsoluteHostDirectory", () => {
  it("rejects relative paths", () => {
    expect(() => assertAbsoluteHostDirectory("tmp/foo")).toThrow(/absolute/);
  });
});

describe("copyHostDirectorySkippingGit", () => {
  let src: string;
  let dest: string;

  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), "forge-host-src-"));
    dest = mkdtempSync(join(tmpdir(), "forge-host-dest-"));
  });

  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });

  it("copies gitignore and skips the source git dir", () => {
    writeFileSync(join(src, ".gitignore"), "node_modules\n");
    writeFileSync(join(src, "app.txt"), "hello\n");
    mkdirSync(join(src, ".git"));
    writeFileSync(join(src, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(src, "node_modules"));
    writeFileSync(join(src, "node_modules", "pkg.js"), "nope\n");

    copyHostDirectorySkippingGit(src, dest);

    expect(readFileSync(join(dest, ".gitignore"), "utf8")).toContain("node_modules");
    expect(readFileSync(join(dest, "app.txt"), "utf8")).toBe("hello\n");
    expect(existsSync(join(dest, ".git"))).toBe(false);
  });
});

describe("importHostDirectoryToRepo", () => {
  let bare: string;
  let clone: string;
  let host: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "forge-import-"));
    bare = join(root, "bare.git");
    clone = join(root, "clone");
    host = join(root, "host");
    mkdirSync(host);
    git(["init", "--bare", bare], root);
    git(["clone", bare, clone], root);
    writeFileSync(join(clone, "README.md"), "# seed\n");
    writeFileSync(join(clone, "Forgefile"), "version: 1\n");
    git(["add", "-A"], clone);
    git(["-c", "user.name=Forge", "-c", "user.email=forge@localhost", "commit", "-m", "seed"], clone);
    git(["push", "-u", "origin", "HEAD"], clone);

    writeFileSync(join(host, ".gitignore"), "node_modules\n");
    writeFileSync(join(host, "app.js"), "export default 1\n");
    mkdirSync(join(host, "node_modules"));
    writeFileSync(join(host, "node_modules", "x.js"), "ignored\n");
  });

  afterEach(() => {
    rmSync(join(clone, ".."), { recursive: true, force: true });
  });

  it("commits imported files and does not stage node_modules", async () => {
    const sha = await importHostDirectoryToRepo({ hostPath: host, clonePath: clone });
    expect(sha).toBeTruthy();
    expect(readFileSync(join(clone, "app.js"), "utf8")).toContain("export default");
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: clone,
      encoding: "utf8",
    });
    expect(tracked).toContain("app.js");
    expect(tracked).toContain(".gitignore");
    expect(tracked).not.toContain("node_modules");
  });
});
