import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeForgeRecoverRequest } from "@/lib/forge-recover-auth";

describe("authorizeForgeRecoverRequest", () => {
  let previousRecover: string | undefined;
  let previousOps: string | undefined;

  beforeEach(() => {
    previousRecover = process.env.FORGE_RECOVER_SECRET;
    previousOps = process.env.FORGE_OPS_API_TOKEN;
  });

  afterEach(() => {
    if (previousRecover === undefined) delete process.env.FORGE_RECOVER_SECRET;
    else process.env.FORGE_RECOVER_SECRET = previousRecover;
    if (previousOps === undefined) delete process.env.FORGE_OPS_API_TOKEN;
    else process.env.FORGE_OPS_API_TOKEN = previousOps;
  });

  it("rejects missing tokens", () => {
    delete process.env.FORGE_RECOVER_SECRET;
    delete process.env.FORGE_OPS_API_TOKEN;
    expect(authorizeForgeRecoverRequest(new Request("http://localhost"))).toBe(
      false,
    );
  });

  it("accepts FORGE_RECOVER_SECRET bearer", () => {
    process.env.FORGE_RECOVER_SECRET = "recover-secret";
    delete process.env.FORGE_OPS_API_TOKEN;
    expect(
      authorizeForgeRecoverRequest(
        new Request("http://localhost", {
          headers: { authorization: "Bearer recover-secret" },
        }),
      ),
    ).toBe(true);
  });

  it("accepts global Ops token", () => {
    delete process.env.FORGE_RECOVER_SECRET;
    process.env.FORGE_OPS_API_TOKEN = "ops-global";
    expect(
      authorizeForgeRecoverRequest(
        new Request("http://localhost", {
          headers: { authorization: "Bearer ops-global" },
        }),
      ),
    ).toBe(true);
    expect(
      authorizeForgeRecoverRequest(
        new Request("http://localhost", {
          headers: { authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
  });
});
