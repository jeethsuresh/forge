import { afterEach, describe, expect, it } from "vitest";
import { sessionCookieSecure } from "./session";

describe("sessionCookieSecure", () => {
  const prev = process.env.FORGE_SESSION_SECURE_COOKIE;

  afterEach(() => {
    if (prev === undefined) delete process.env.FORGE_SESSION_SECURE_COOKIE;
    else process.env.FORGE_SESSION_SECURE_COOKIE = prev;
  });

  it("defaults to false so HTTP deployments accept the session cookie", () => {
    delete process.env.FORGE_SESSION_SECURE_COOKIE;
    expect(sessionCookieSecure()).toBe(false);
  });

  it("enables Secure when explicitly configured", () => {
    process.env.FORGE_SESSION_SECURE_COOKIE = "true";
    expect(sessionCookieSecure()).toBe(true);

    process.env.FORGE_SESSION_SECURE_COOKIE = "1";
    expect(sessionCookieSecure()).toBe(true);

    process.env.FORGE_SESSION_SECURE_COOKIE = "yes";
    expect(sessionCookieSecure()).toBe(true);
  });

  it("treats other values as false", () => {
    process.env.FORGE_SESSION_SECURE_COOKIE = "false";
    expect(sessionCookieSecure()).toBe(false);
  });
});
