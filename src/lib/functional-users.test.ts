import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { functionalUsers, users } from "@/lib/db/schema";
import {
  createFunctionalUser,
  deleteFunctionalUser,
  listFunctionalUsers,
  mintFunctionalUserToken,
  regenerateFunctionalUserToken,
} from "@/lib/functional-users";

describe("functional users", () => {
  let previousSessionSecret: string | undefined;
  const names: string[] = [];

  beforeEach(() => {
    previousSessionSecret = process.env.FORGE_OPS_SESSION_SECRET;
    process.env.FORGE_OPS_SESSION_SECRET = "test-functional-user-secret";
  });

  afterEach(() => {
    for (const name of names.splice(0)) {
      db.delete(functionalUsers).where(eq(functionalUsers.name, name)).run();
    }
    if (previousSessionSecret === undefined) {
      delete process.env.FORGE_OPS_SESSION_SECRET;
    } else {
      process.env.FORGE_OPS_SESSION_SECRET = previousSessionSecret;
    }
  });

  it("mints stable fmu tokens and remints the same secret", () => {
    const created = createFunctionalUser("claude-desktop");
    names.push("claude-desktop");
    expect(created.token.startsWith(`fmu.${created.user.id}.`)).toBe(true);
    expect(mintFunctionalUserToken(created.user.id, created.user.tokenVersion)).toBe(
      created.token,
    );
    expect(listFunctionalUsers().find((row) => row.id === created.user.id)?.token).toBe(
      created.token,
    );
  });

  it("rotates by bumping tokenVersion and invalidates the old secret", () => {
    const created = createFunctionalUser("cursor-mcp");
    names.push("cursor-mcp");
    const old = created.token;
    const rotated = regenerateFunctionalUserToken(created.user.id);
    expect(rotated?.user.tokenVersion).toBe(2);
    expect(rotated?.token).not.toBe(old);
    expect(mintFunctionalUserToken(created.user.id, 1)).toBe(old);
  });

  it("rejects empty and duplicate names and does not create dashboard users", () => {
    expect(() => createFunctionalUser("  ")).toThrow(/Invalid name/);
    const created = createFunctionalUser("shared-name");
    names.push("shared-name");
    expect(() => createFunctionalUser("shared-name")).toThrow(/already registered/);
    expect(
      db.select().from(users).all().some((row) => row.username === "shared-name"),
    ).toBe(false);
    expect(created.user.id).toBeTruthy();
  });

  it("delete removes the row so remint cannot succeed from a leftover version", () => {
    const created = createFunctionalUser("to-revoke");
    expect(deleteFunctionalUser(created.user.id)).toBe(true);
    expect(listFunctionalUsers().some((row) => row.id === created.user.id)).toBe(false);
    expect(deleteFunctionalUser(created.user.id)).toBe(false);
  });
});
