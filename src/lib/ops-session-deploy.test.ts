import { describe, expect, it } from "vitest";
import { shouldAuthorizeActiveSessionDeploy } from "@/lib/ops-session-deploy";

describe("shouldAuthorizeActiveSessionDeploy", () => {
  it("allows same session token with flag", () => {
    expect(
      shouldAuthorizeActiveSessionDeploy({
        auth: { kind: "session", sessionId: "s1", projectId: "p1" },
        authorizeActiveSessionDeploy: true,
        blockingSessionId: "s1",
      }),
    ).toBe(true);
  });

  it("rejects global token even with flag", () => {
    expect(
      shouldAuthorizeActiveSessionDeploy({
        auth: { kind: "global" },
        authorizeActiveSessionDeploy: true,
        blockingSessionId: "s1",
      }),
    ).toBe(false);
  });

  it("rejects mismatched session id", () => {
    expect(
      shouldAuthorizeActiveSessionDeploy({
        auth: { kind: "session", sessionId: "s1", projectId: "p1" },
        authorizeActiveSessionDeploy: true,
        blockingSessionId: "s2",
      }),
    ).toBe(false);
  });

  it("rejects when flag is false", () => {
    expect(
      shouldAuthorizeActiveSessionDeploy({
        auth: { kind: "session", sessionId: "s1", projectId: "p1" },
        authorizeActiveSessionDeploy: false,
        blockingSessionId: "s1",
      }),
    ).toBe(false);
  });
});
