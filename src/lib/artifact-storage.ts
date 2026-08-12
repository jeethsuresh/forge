import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve, sep } from "path";

export type ArtifactStorage = {
  put(key: string, localFilePath: string): Promise<{ sizeBytes: number }>;
  get(key: string): Promise<{ absolutePath: string } | null>;
  delete(key: string): Promise<void>;
  signedDownload(
    key: string,
    expiresSec: number,
  ): Promise<{ urlPath: string; token: string; expiresAt: Date }>;
};

const TOKEN_PREFIX = "fad.";

function resolveArtifactDownloadSecret(): string {
  const fromEnv = process.env.FORGE_ARTIFACT_DOWNLOAD_SECRET?.trim();
  if (fromEnv) return fromEnv;

  // Fall back to ops session secret so download tokens work without extra config.
  const ops = process.env.FORGE_OPS_SESSION_SECRET?.trim();
  if (ops) return ops;

  if (process.env.FORGE_DB_PATH === ":memory:") {
    return "test-artifact-download-secret";
  }

  const dbPath = process.env.FORGE_DB_PATH ?? "./data/forge.db";
  const secretPath = join(dirname(dbPath), "forge-artifact-download-secret");
  if (existsSync(secretPath)) {
    const existing = readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  }
  const generated = randomBytes(32).toString("hex");
  mkdirSync(dirname(secretPath), { recursive: true });
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

function assertSafeKey(key: string): void {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Invalid artifact storage key: ${key}`);
  }
}

function absolutePathForKey(rootDir: string, key: string): string {
  assertSafeKey(key);
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolute = resolve(rootDir, ...normalized.split("/"));
  const rootResolved = resolve(rootDir);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + sep)) {
    throw new Error(`Invalid artifact storage key: ${key}`);
  }
  return absolute;
}

export function mintArtifactDownloadToken(
  key: string,
  expiresAt: Date,
): string {
  const secret = resolveArtifactDownloadSecret();
  const exp = Math.floor(expiresAt.getTime() / 1000).toString();
  const mac = createHmac("sha256", secret)
    .update(`forge-artifact-v1:${key}:${exp}`)
    .digest("base64url");
  return `${TOKEN_PREFIX}${exp}.${mac}`;
}

export function verifyArtifactDownloadToken(
  token: string,
  key: string,
  expiresAt?: Date,
): boolean {
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return false;
  const exp = rest.slice(0, dot);
  const mac = rest.slice(dot + 1);
  if (!exp || !mac) return false;

  const expSec = Number(exp);
  if (!Number.isFinite(expSec)) return false;
  if (expSec * 1000 < Date.now()) return false;
  if (expiresAt && Math.floor(expiresAt.getTime() / 1000) !== expSec) {
    return false;
  }

  const secret = resolveArtifactDownloadSecret();
  const expected = createHmac("sha256", secret)
    .update(`forge-artifact-v1:${key}:${exp}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createDiskArtifactStorage(rootDir: string): ArtifactStorage {
  mkdirSync(rootDir, { recursive: true });

  return {
    async put(key, localFilePath) {
      const dest = absolutePathForKey(rootDir, key);
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = join(dirname(dest), `.${basename(dest)}.tmp-${randomBytes(4).toString("hex")}`);
      copyFileSync(localFilePath, tmp);
      renameSync(tmp, dest);
      const sizeBytes = statSync(dest).size;
      return { sizeBytes };
    },

    async get(key) {
      const absolutePath = absolutePathForKey(rootDir, key);
      if (!existsSync(absolutePath)) return null;
      return { absolutePath };
    },

    async delete(key) {
      const absolutePath = absolutePathForKey(rootDir, key);
      if (!existsSync(absolutePath)) return;
      rmSync(absolutePath, { force: true });
    },

    async signedDownload(key, expiresSec) {
      assertSafeKey(key);
      const expiresAt = new Date(Date.now() + Math.max(1, expiresSec) * 1000);
      const token = mintArtifactDownloadToken(key, expiresAt);
      const urlPath = `?token=${encodeURIComponent(token)}&expires=${Math.floor(expiresAt.getTime() / 1000)}`;
      return { urlPath, token, expiresAt };
    },
  };
}
