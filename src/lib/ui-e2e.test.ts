import { describe, expect, it } from "vitest";
import {
  forgeAdminCredentials,
  parseDotEnvValue,
  shouldRunUiE2e,
  uiE2eBaseUrl,
} from "@/lib/ui-e2e";

describe("shouldRunUiE2e", () => {
  it("is off during self-update staging even if forced", () => {
    expect(
      shouldRunUiE2e({
        FORGE_UI_E2E: "1",
        FORGE_UPDATE_ID: "abc",
      }),
    ).toBe(false);
  });

  it("honors explicit on/off", () => {
    expect(shouldRunUiE2e({ FORGE_UI_E2E: "1" })).toBe(true);
    expect(
      shouldRunUiE2e({
        FORGE_UI_E2E: "0",
        FORGE_LIVE_SMOKE: "1",
      }),
    ).toBe(false);
  });

  it("follows live-smoke when unset", () => {
    expect(
      shouldRunUiE2e({
        FORGE_LIVE_SMOKE: "1",
      }),
    ).toBe(true);
    expect(shouldRunUiE2e({})).toBe(false);
  });
});

describe("parseDotEnvValue / forgeAdminCredentials", () => {
  it("parses quoted and unquoted keys", () => {
    const text = 'FORGE_ADMIN_USERNAME=admin\nFORGE_ADMIN_PASSWORD="s3cret"\n';
    expect(parseDotEnvValue(text, "FORGE_ADMIN_USERNAME")).toBe("admin");
    expect(parseDotEnvValue(text, "FORGE_ADMIN_PASSWORD")).toBe("s3cret");
  });

  it("falls back to admin/admin", () => {
    expect(forgeAdminCredentials({})).toEqual({
      username: "admin",
      password: "admin",
    });
    expect(
      forgeAdminCredentials({
        FORGE_ADMIN_USERNAME: "ops",
        FORGE_ADMIN_PASSWORD: "x",
      }),
    ).toEqual({ username: "ops", password: "x" });
  });
});

describe("uiE2eBaseUrl", () => {
  it("strips trailing slash", () => {
    expect(uiE2eBaseUrl({ FORGE_OPS_API_BASE: "http://127.0.0.1:3000/" })).toBe(
      "http://127.0.0.1:3000",
    );
  });
});
