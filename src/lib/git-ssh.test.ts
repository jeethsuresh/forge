import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitSshKeys } from "@/lib/db/schema";
import {
  addGitSshKey,
  isSshKeyAuthorized,
  parseSshPublicKey,
  removeGitSshKey,
  syncAuthorizedKeysFile,
  authorizedKeysPath,
} from "@/lib/git-ssh";

// Real ed25519 public key (private key discarded after generation).
const SAMPLE_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPXZ4o7OLXzEgAvCxSKUu4e1EO62UCi1Avdu8vK3FdIL forge-test";

describe("parseSshPublicKey", () => {
  it("parses type, data, comment, and fingerprint", () => {
    const parsed = parseSshPublicKey(SAMPLE_KEY);
    expect(parsed.type).toBe("ssh-ed25519");
    expect(parsed.comment).toBe("forge-test");
    expect(parsed.fingerprint.startsWith("SHA256:")).toBe(true);
  });

  it("rejects empty and unsupported types", () => {
    expect(() => parseSshPublicKey("")).toThrow(/empty/i);
    expect(() => parseSshPublicKey("ssh-dss AAAAB3Nza test")).toThrow(
      /Unsupported/,
    );
  });
});

describe("git ssh key registry", () => {
  let sshDir: string;
  let prev: string | undefined;
  const createdIds: string[] = [];

  beforeEach(() => {
    sshDir = mkdtempSync(join(tmpdir(), "forge-ssh-"));
    prev = process.env.FORGE_GIT_SSH_DIR;
    process.env.FORGE_GIT_SSH_DIR = sshDir;
  });

  afterEach(() => {
    for (const id of createdIds.splice(0)) {
      db.delete(gitSshKeys).where(eq(gitSshKeys.id, id)).run();
    }
    if (prev === undefined) delete process.env.FORGE_GIT_SSH_DIR;
    else process.env.FORGE_GIT_SSH_DIR = prev;
    rmSync(sshDir, { recursive: true, force: true });
  });

  it("adds, authorizes, syncs authorized_keys, and removes", () => {
    const row = addGitSshKey({
      name: "laptop",
      publicKey: SAMPLE_KEY,
      scope: "user",
    });
    createdIds.push(row.id);

    expect(isSshKeyAuthorized(SAMPLE_KEY)).toBe(true);
    expect(isSshKeyAuthorized(row.fingerprint)).toBe(true);

    const path = syncAuthorizedKeysFile();
    expect(path).toBe(authorizedKeysPath());
    const body = readFileSync(path, "utf8");
    expect(body).toContain(row.publicKey);
    expect(body).toContain(row.fingerprint);

    expect(removeGitSshKey(row.id)).toBe(true);
    createdIds.pop();
    expect(isSshKeyAuthorized(SAMPLE_KEY)).toBe(false);
  });
});
