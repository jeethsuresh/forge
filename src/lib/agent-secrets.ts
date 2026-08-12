import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { secretRequests, secrets, type SecretScope } from "@/lib/db/schema";
import { resolveOpsSessionSecret } from "@/lib/ops-api-auth";

/** Names agents may never retrieve (host/docker privileged material). */
export const SECRET_NAME_DENYLIST = [
  "DOCKER_HOST",
  "DOCKER_SOCKET",
  "FORGE_DOCKER_SOCKET",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "PODMAN_SOCK",
  "SSH_PRIVATE_KEY",
  "HOST_PATH",
  "FORGE_HOST_MOUNTS",
] as const;

function secretsKey(): Buffer {
  const fromEnv = process.env.FORGE_SECRETS_KEY?.trim();
  const material = fromEnv || resolveOpsSessionSecret();
  return createHash("sha256").update(`forge-secrets-v1:${material}`).digest();
}

export function encryptSecretValue(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretsKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecretValue(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported secret ciphertext format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, "base64url");
  const tag = Buffer.from(tagB64!, "base64url");
  const data = Buffer.from(dataB64!, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", secretsKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function isDeniedSecretName(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  if (!normalized) return true;
  if (SECRET_NAME_DENYLIST.includes(normalized as (typeof SECRET_NAME_DENYLIST)[number])) {
    return true;
  }
  if (normalized.includes("DOCKER") && normalized.includes("SOCK")) return true;
  if (normalized.startsWith("HOST_") && normalized.includes("PATH")) return true;
  return false;
}

export function storeSecret(input: {
  scope: SecretScope;
  projectId?: string | null;
  name: string;
  value: string;
}): { id: string } {
  const name = input.name.trim();
  if (!name) throw new Error("Secret name is required");
  if (input.scope === "project" && !input.projectId) {
    throw new Error("projectId is required for project-scoped secrets");
  }

  const existing = db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.scope, input.scope),
        eq(secrets.name, name),
        input.scope === "global"
          ? isNull(secrets.projectId)
          : eq(secrets.projectId, input.projectId!),
      ),
    )
    .get();

  const ciphertext = encryptSecretValue(input.value);
  if (existing) {
    db.update(secrets)
      .set({ ciphertext })
      .where(eq(secrets.id, existing.id))
      .run();
    return { id: existing.id };
  }

  const id = randomUUID();
  db.insert(secrets)
    .values({
      id,
      scope: input.scope,
      projectId: input.scope === "project" ? input.projectId! : null,
      name,
      ciphertext,
      createdAt: new Date(),
    })
    .run();
  return { id };
}

function findSecret(projectId: string, name: string) {
  const projectSecret = db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.scope, "project"),
        eq(secrets.projectId, projectId),
        eq(secrets.name, name),
      ),
    )
    .get();
  if (projectSecret) return projectSecret;

  return db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.scope, "global"),
        isNull(secrets.projectId),
        eq(secrets.name, name),
      ),
    )
    .get();
}

export type SecretRequestResult =
  | { allowed: false; reason: string }
  | { allowed: true; value: string };

function auditSecretRequest(input: {
  sessionId: string;
  projectId: string;
  name: string;
  allowed: boolean;
  reason: string;
}): void {
  db.insert(secretRequests)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      projectId: input.projectId,
      name: input.name,
      allowed: input.allowed,
      reason: input.reason,
      createdAt: new Date(),
    })
    .run();
}

export function requestProjectSecret(
  sessionId: string,
  projectId: string,
  name: string,
): SecretRequestResult {
  const trimmed = name.trim();
  if (!trimmed) {
    const reason = "Secret name is required";
    auditSecretRequest({
      sessionId,
      projectId,
      name: trimmed,
      allowed: false,
      reason,
    });
    return { allowed: false, reason };
  }

  if (isDeniedSecretName(trimmed)) {
    const reason = `Secret "${trimmed}" is denied (docker/host privileged material)`;
    auditSecretRequest({
      sessionId,
      projectId,
      name: trimmed,
      allowed: false,
      reason,
    });
    return { allowed: false, reason };
  }

  const row = findSecret(projectId, trimmed);
  if (!row) {
    const reason = `Secret "${trimmed}" not found for this project`;
    auditSecretRequest({
      sessionId,
      projectId,
      name: trimmed,
      allowed: false,
      reason,
    });
    return { allowed: false, reason };
  }

  try {
    const value = decryptSecretValue(row.ciphertext);
    auditSecretRequest({
      sessionId,
      projectId,
      name: trimmed,
      allowed: true,
      reason: "granted",
    });
    return { allowed: true, value };
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Failed to decrypt secret";
    auditSecretRequest({
      sessionId,
      projectId,
      name: trimmed,
      allowed: false,
      reason,
    });
    return { allowed: false, reason };
  }
}

/** Test helper: list audit rows for a session. */
export function listSecretRequestsForSession(sessionId: string) {
  return db
    .select()
    .from(secretRequests)
    .where(eq(secretRequests.sessionId, sessionId))
    .all();
}
