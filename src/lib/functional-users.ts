import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { functionalUsers, type FunctionalUser } from "@/lib/db/schema";
import { mintFunctionalUserToken } from "@/lib/ops-api-auth";

export { mintFunctionalUserToken };

const MAX_NAME_LENGTH = 80;

export type FunctionalUserWithToken = FunctionalUser & { token: string };

export function normalizeFunctionalUserName(value: string): string {
  return value.trim();
}

function assertValidName(name: string): string {
  const normalized = normalizeFunctionalUserName(name);
  if (!normalized || normalized.length > MAX_NAME_LENGTH) {
    throw new Error("Invalid name");
  }
  return normalized;
}

function withToken(user: FunctionalUser): FunctionalUserWithToken {
  return {
    ...user,
    token: mintFunctionalUserToken(user.id, user.tokenVersion),
  };
}

export function createFunctionalUser(name: string): {
  user: FunctionalUser;
  token: string;
} {
  const normalized = assertValidName(name);
  const existing = db
    .select()
    .from(functionalUsers)
    .where(eq(functionalUsers.name, normalized))
    .get();
  if (existing) {
    throw new Error("Name already registered");
  }

  const now = new Date();
  const user: FunctionalUser = {
    id: randomUUID(),
    name: normalized,
    tokenVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(functionalUsers).values(user).run();
  return { user, token: mintFunctionalUserToken(user.id, user.tokenVersion) };
}

export function listFunctionalUsers(): FunctionalUserWithToken[] {
  return db
    .select()
    .from(functionalUsers)
    .all()
    .map(withToken);
}

export function getFunctionalUser(id: string): FunctionalUser | undefined {
  return db
    .select()
    .from(functionalUsers)
    .where(eq(functionalUsers.id, id))
    .get();
}

export function regenerateFunctionalUserToken(
  id: string,
): { user: FunctionalUser; token: string } | null {
  const existing = getFunctionalUser(id);
  if (!existing) return null;
  const now = new Date();
  const tokenVersion = existing.tokenVersion + 1;
  db.update(functionalUsers)
    .set({ tokenVersion, updatedAt: now })
    .where(eq(functionalUsers.id, id))
    .run();
  const user = { ...existing, tokenVersion, updatedAt: now };
  return { user, token: mintFunctionalUserToken(user.id, user.tokenVersion) };
}

export function deleteFunctionalUser(id: string): boolean {
  const result = db
    .delete(functionalUsers)
    .where(eq(functionalUsers.id, id))
    .run();
  return (result.changes ?? 0) > 0;
}
