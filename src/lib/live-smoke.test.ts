import { afterEach, describe, expect, it } from "vitest";
import {
  isAgentOpsContext,
  isSelfUpdateTestStage,
  liveSmokeLogsContainForbiddenFailure,
  shouldRunLiveSmoke,
} from "@/lib/live-smoke";

describe("live-smoke enablement", () => {
  afterEach(() => {
    // no module cache; helpers take env arg
  });

  it("detects agent ops context from fos token + base", () => {
    expect(
      isAgentOpsContext({
        FORGE_OPS_API_TOKEN: "fos.session.mac",
        FORGE_OPS_API_BASE: "http://127.0.0.1:3000",
      }),
    ).toBe(true);
    expect(
      isAgentOpsContext({
        FORGE_OPS_API_TOKEN: "global-secret",
        FORGE_OPS_API_BASE: "http://127.0.0.1:3000",
      }),
    ).toBe(false);
    expect(
      isAgentOpsContext({
        FORGE_OPS_API_TOKEN: "fos.session.mac",
      }),
    ).toBe(false);
  });

  it("detects self-update test stage", () => {
    expect(isSelfUpdateTestStage({ FORGE_UPDATE_ID: "abc" })).toBe(true);
    expect(isSelfUpdateTestStage({ FORGE_UPDATER: "1" })).toBe(true);
    expect(
      isSelfUpdateTestStage({ COMPOSE_PROJECT_NAME: "forge-staging-xyz" }),
    ).toBe(true);
    expect(isSelfUpdateTestStage({ COMPOSE_PROJECT_NAME: "forge" })).toBe(
      false,
    );
  });

  it("respects force off, force on, agent auto, and updater nest ban", () => {
    expect(
      shouldRunLiveSmoke({
        FORGE_LIVE_SMOKE: "0",
        FORGE_OPS_API_TOKEN: "fos.s.m",
        FORGE_OPS_API_BASE: "http://x",
      }),
    ).toBe(false);
    expect(shouldRunLiveSmoke({ FORGE_LIVE_SMOKE: "1" })).toBe(true);
    expect(
      shouldRunLiveSmoke({
        FORGE_OPS_API_TOKEN: "fos.s.m",
        FORGE_OPS_API_BASE: "http://x",
      }),
    ).toBe(true);
    expect(
      shouldRunLiveSmoke({
        FORGE_LIVE_SMOKE: "1",
        FORGE_UPDATE_ID: "nested",
      }),
    ).toBe(false);
  });

  it("flags forbidden cutover log patterns", () => {
    expect(
      liveSmokeLogsContainForbiddenFailure(
        "Install the buildx component to build images with BuildKit",
      ),
    ).toBeTruthy();
    expect(
      liveSmokeLogsContainForbiddenFailure(
        "cannot open '.git/FETCH_HEAD': Permission denied",
      ),
    ).toBeTruthy();
    expect(
      liveSmokeLogsContainForbiddenFailure(
        "Cannot connect to container runtime at tcp://127.0.0.1:18765",
      ),
    ).toBeNull();
  });
});
