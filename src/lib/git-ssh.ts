import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  gitSshKeys,
  type GitSshKey,
  type GitSshKeyScope,
} from "@/lib/db/schema";

export type ParsedSshPublicKey = {
  type: string;
  keyData: string;
  comment: string;
  normalized: string;
  fingerprint: string;
};

const SSH_KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

/** Directory for authorized_keys consumed by an optional git-ssh sidecar. */
export function resolveGitSshDir(): string {
  const override = process.env.FORGE_GIT_SSH_DIR?.trim();
  if (override) return resolve(override);

  const dbPath = process.env.FORGE_DB_PATH ?? "./data/forge.db";
  if (dbPath === ":memory:") {
    return resolve("/tmp/forge-git-ssh-test");
  }
  return join(dirname(resolve(dbPath)), "git-ssh");
}

export function authorizedKeysPath(): string {
  return join(resolveGitSshDir(), "authorized_keys");
}

export function fingerprintSshKeyData(keyData: string): string {
  const raw = Buffer.from(keyData, "base64");
  const digest = createHash("sha256").update(raw).digest("base64");
  // OpenSSH-style fingerprint without trailing '=' padding.
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

export function parseSshPublicKey(input: string): ParsedSshPublicKey {
  const line = input
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (!line) {
    throw new Error("SSH public key is empty");
  }

  const parts = line.split(/\s+/);
  if (parts.length < 2) {
    throw new Error("SSH public key must be: <type> <base64> [comment]");
  }

  const [type, keyData, ...commentParts] = parts;
  if (!SSH_KEY_TYPES.has(type)) {
    throw new Error(`Unsupported SSH key type: ${type}`);
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(keyData)) {
    throw new Error("SSH public key data is not valid base64");
  }

  const comment = commentParts.join(" ").trim();
  const normalized = comment
    ? `${type} ${keyData} ${comment}`
    : `${type} ${keyData}`;
  return {
    type,
    keyData,
    comment,
    normalized,
    fingerprint: fingerprintSshKeyData(keyData),
  };
}

export function isSshKeyAuthorized(publicKeyOrFingerprint: string): boolean {
  try {
    const parsed = parseSshPublicKey(publicKeyOrFingerprint);
    const byFp = db
      .select()
      .from(gitSshKeys)
      .where(eq(gitSshKeys.fingerprint, parsed.fingerprint))
      .get();
    return Boolean(byFp);
  } catch {
    const byFp = db
      .select()
      .from(gitSshKeys)
      .where(eq(gitSshKeys.fingerprint, publicKeyOrFingerprint))
      .get();
    return Boolean(byFp);
  }
}

export function listGitSshKeys(): GitSshKey[] {
  return db
    .select()
    .from(gitSshKeys)
    .orderBy(desc(gitSshKeys.createdAt))
    .all();
}

export function syncAuthorizedKeysFile(keys?: GitSshKey[]): string {
  const rows = keys ?? listGitSshKeys();
  const dir = resolveGitSshDir();
  mkdirSync(dir, { recursive: true });
  const path = authorizedKeysPath();
  const body =
    rows.length === 0
      ? "# Forge git SSH keys — none registered\n"
      : `${rows
          .map(
            (k) =>
              `# ${k.name} (${k.scope}) ${k.fingerprint}\n${k.publicKey}\n`,
          )
          .join("\n")}\n`;
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

export function addGitSshKey(opts: {
  name: string;
  publicKey: string;
  scope?: GitSshKeyScope;
}): GitSshKey {
  const name = opts.name.trim();
  if (!name) throw new Error("Key name is required");
  if (name.length > 120) throw new Error("Key name is too long");

  const parsed = parseSshPublicKey(opts.publicKey);
  const existing = db
    .select()
    .from(gitSshKeys)
    .where(eq(gitSshKeys.fingerprint, parsed.fingerprint))
    .get();
  if (existing) {
    throw new Error("This SSH key is already registered");
  }

  const scope: GitSshKeyScope =
    opts.scope === "deploy" ? "deploy" : "user";
  const row: GitSshKey = {
    id: randomUUID(),
    name,
    publicKey: parsed.normalized,
    fingerprint: parsed.fingerprint,
    scope,
    createdAt: new Date(),
  };
  db.insert(gitSshKeys).values(row).run();
  syncAuthorizedKeysFile();
  return row;
}

export function removeGitSshKey(id: string): boolean {
  const existing = db
    .select()
    .from(gitSshKeys)
    .where(eq(gitSshKeys.id, id))
    .get();
  if (!existing) return false;
  db.delete(gitSshKeys).where(eq(gitSshKeys.id, id)).run();
  syncAuthorizedKeysFile();
  return true;
}

export function authorizedKeysFileExists(): boolean {
  return existsSync(authorizedKeysPath());
}
