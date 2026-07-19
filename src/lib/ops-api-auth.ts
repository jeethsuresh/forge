import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";

const MAC_PAYLOAD_PREFIX = "forge-ops-v1:";

export type OpsAuth =
  | { kind: "global" }
  | { kind: "session"; sessionId: string; projectId: string };

let memorySecret: string | null = null;

export function opsApiBaseUrl(): string {
  const configured = process.env.FORGE_OPS_API_BASE?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

function opsSessionSecretPath(): string {
  if (process.env.FORGE_OPS_SESSION_SECRET_FILE?.trim()) {
    return process.env.FORGE_OPS_SESSION_SECRET_FILE.trim();
  }
  const dbPath = process.env.FORGE_DB_PATH ?? "./data/forge.db";
  if (dbPath === ":memory:") {
    return join("/tmp", "forge-ops-session-secret-test");
  }
  return join(dirname(dbPath), "forge-ops-session-secret");
}

export function resolveOpsSessionSecret(): string {
  const fromEnv = process.env.FORGE_OPS_SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.FORGE_DB_PATH === ":memory:") {
    if (!memorySecret) memorySecret = randomBytes(32).toString("hex");
    return memorySecret;
  }

  const path = opsSessionSecretPath();
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  }
  const generated = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generated, { mode: 0o600 });
  return generated;
}

export function mintSessionOpsToken(sessionId: string, projectId: string): string {
  const secret = resolveOpsSessionSecret();
  const mac = createHmac("sha256", secret)
    .update(`${MAC_PAYLOAD_PREFIX}${sessionId}:${projectId}`)
    .digest("base64url");
  return `fos.${sessionId}.${mac}`;
}

function parseSessionOpsToken(
  token: string,
): { sessionId: string; mac: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "fos") return null;
  const [, sessionId, mac] = parts;
  if (!sessionId || !mac) return null;
  return { sessionId, mac };
}

function macEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function presentedOpsToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const bearer = authorization.slice("Bearer ".length).trim();
    if (bearer) return bearer;
  }
  return request.headers.get("x-forge-ops-token")?.trim() || null;
}

export function authenticateOpsRequest(request: Request): OpsAuth | null {
  const presented = presentedOpsToken(request);
  if (!presented) return null;

  const global = process.env.FORGE_OPS_API_TOKEN?.trim();
  if (global && presented === global) {
    return { kind: "global" };
  }

  const parsed = parseSessionOpsToken(presented);
  if (!parsed) return null;

  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, parsed.sessionId))
    .get();
  if (!session || session.archivedAt) return null;

  const expected = mintSessionOpsToken(session.id, session.projectId);
  const expectedParsed = parseSessionOpsToken(expected);
  if (!expectedParsed || !macEqual(parsed.mac, expectedParsed.mac)) {
    return null;
  }

  return {
    kind: "session",
    sessionId: session.id,
    projectId: session.projectId,
  };
}

export function isOpsApiConfigured(): boolean {
  if (process.env.FORGE_OPS_API_TOKEN?.trim()) return true;
  try {
    return Boolean(resolveOpsSessionSecret());
  } catch {
    return false;
  }
}

/** @deprecated Prefer authenticateOpsRequest — kept for callers expecting a boolean. */
export function verifyOpsApiToken(request: Request): boolean {
  return authenticateOpsRequest(request) !== null;
}
