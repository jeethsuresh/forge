import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildDeployEnvVarViews,
  deployEnvToRecord,
  fillDeployEnvFromRepo,
  inferSecretFromKey,
  isValidDeployEnvKey,
  maskDeployEnvForClient,
  mergeDeployEnvUpdates,
  parseDeployEnvJson,
  parseEnvFile,
  readRepoEnvFile,
  resolveDeployEnvValue,
  validateDeployEnvInputs,
} from "@/lib/deploy-env";

describe("parseEnvFile", () => {
  it("parses assignments, exports, quotes, and skips comments", () => {
    const content = `
# comment
HOST_PORT=3000
export FORGE_ADMIN_USERNAME=admin
FORGE_SESSION_SECRET="quoted-secret"
EMPTY=
`;
    expect(parseEnvFile(content)).toEqual([
      { key: "HOST_PORT", value: "3000" },
      { key: "FORGE_ADMIN_USERNAME", value: "admin" },
      { key: "FORGE_SESSION_SECRET", value: "quoted-secret" },
      { key: "EMPTY", value: "" },
    ]);
  });
});

describe("inferSecretFromKey", () => {
  it("detects sensitive key names", () => {
    expect(inferSecretFromKey("FORGE_SESSION_SECRET")).toBe(true);
    expect(inferSecretFromKey("FORGE_GITHUB_TOKEN")).toBe(true);
    expect(inferSecretFromKey("HOST_PORT")).toBe(false);
  });
});

describe("buildDeployEnvVarViews", () => {
  it("prefills from repo template when nothing is saved", () => {
    expect(
      buildDeployEnvVarViews(
        [],
        [
          { key: "HOST_PORT", value: "3000", secret: false },
          { key: "FORGE_SESSION_SECRET", value: "change-me", secret: true },
        ],
        ".env.example",
      ),
    ).toEqual([
      { key: "HOST_PORT", value: "3000", secret: false, hasValue: true },
      { key: "FORGE_SESSION_SECRET", value: "change-me", secret: true, hasValue: true },
    ]);
  });

  it("masks secret values from .env templates", () => {
    expect(
      buildDeployEnvVarViews(
        [],
        [{ key: "API_KEY", value: "live-secret", secret: true }],
        ".env",
      ),
    ).toEqual([
      { key: "API_KEY", value: "", secret: true, hasValue: true },
    ]);
  });

  it("keeps saved values over template values", () => {
    expect(
      buildDeployEnvVarViews(
        [{ key: "HOST_PORT", value: "8080", secret: false }],
        [{ key: "HOST_PORT", value: "3000", secret: false }],
        ".env.example",
      ),
    ).toEqual([
      { key: "HOST_PORT", value: "8080", secret: false, hasValue: true },
    ]);
  });
});

describe("fillDeployEnvFromRepo", () => {
  it("fills empty inputs from repo .env values when hasValue is true", () => {
    expect(
      fillDeployEnvFromRepo(
        [{ key: "API_KEY", value: "", secret: true, hasValue: true }],
        [{ key: "API_KEY", value: "from-env", secret: true }],
      ),
    ).toEqual([
      { key: "API_KEY", value: "from-env", secret: true, hasValue: true },
    ]);
  });

  it("does not fill when hasValue is false (explicit clear)", () => {
    expect(
      fillDeployEnvFromRepo(
        [{ key: "API_KEY", value: "", secret: true, hasValue: false }],
        [{ key: "API_KEY", value: "from-env", secret: true }],
      ),
    ).toEqual([
      { key: "API_KEY", value: "", secret: true, hasValue: false },
    ]);
  });

  it("does not fill new empty variables without hasValue", () => {
    expect(
      fillDeployEnvFromRepo(
        [{ key: "API_KEY", value: "", secret: true }],
        [{ key: "API_KEY", value: "from-env", secret: true }],
      ),
    ).toEqual([{ key: "API_KEY", value: "", secret: true }]);
  });
});

describe("readRepoEnvFile", () => {
  it("prefers .env over .env.example", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-env-"));
    writeFileSync(join(dir, ".env.example"), "FROM_EXAMPLE=1\n");
    writeFileSync(join(dir, ".env"), "FROM_ENV=1\n");

    expect(readRepoEnvFile(dir)).toEqual({
      source: ".env",
      vars: [{ key: "FROM_ENV", value: "1", secret: false }],
    });
  });

  it("falls back to .env.example", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-env-"));
    writeFileSync(join(dir, ".env.example"), "HOST_PORT=3000\n");

    expect(readRepoEnvFile(dir)).toEqual({
      source: ".env.example",
      vars: [{ key: "HOST_PORT", value: "3000", secret: false }],
    });
  });
});

describe("isValidDeployEnvKey", () => {
  it("accepts valid POSIX-style names", () => {
    expect(isValidDeployEnvKey("DATABASE_URL")).toBe(true);
    expect(isValidDeployEnvKey("_PRIVATE")).toBe(true);
    expect(isValidDeployEnvKey("PORT2")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(isValidDeployEnvKey("2BAD")).toBe(false);
    expect(isValidDeployEnvKey("has-dash")).toBe(false);
    expect(isValidDeployEnvKey("")).toBe(false);
  });
});

describe("parseDeployEnvJson", () => {
  it("returns empty array for missing or invalid JSON", () => {
    expect(parseDeployEnvJson(null)).toEqual([]);
    expect(parseDeployEnvJson("")).toEqual([]);
    expect(parseDeployEnvJson("{}")).toEqual([]);
    expect(parseDeployEnvJson("not-json")).toEqual([]);
  });

  it("parses stored variables", () => {
    const raw = JSON.stringify([
      { key: "API_KEY", value: "secret", secret: true },
      { key: "PORT", value: "3000", secret: false },
      { key: "bad-key", value: "x", secret: false },
    ]);
    expect(parseDeployEnvJson(raw)).toEqual([
      { key: "API_KEY", value: "secret", secret: true },
      { key: "PORT", value: "3000", secret: false },
    ]);
  });
});

describe("maskDeployEnvForClient", () => {
  it("hides secret values but reports hasValue", () => {
    expect(
      maskDeployEnvForClient([
        { key: "API_KEY", value: "secret", secret: true },
        { key: "PORT", value: "3000", secret: false },
      ]),
    ).toEqual([
      { key: "API_KEY", value: "", secret: true, hasValue: true },
      { key: "PORT", value: "3000", secret: false, hasValue: true },
    ]);
  });
});

describe("validateDeployEnvInputs", () => {
  it("rejects invalid and duplicate keys", () => {
    expect(
      validateDeployEnvInputs([
        { key: "GOOD", value: "1" },
        { key: "2BAD", value: "2" },
      ]),
    ).toMatch(/Invalid environment variable name/);

    expect(
      validateDeployEnvInputs([
        { key: "FOO", value: "1" },
        { key: "foo", value: "2" },
      ]),
    ).toMatch(/Duplicate environment variable/);
  });
});

describe("mergeDeployEnvUpdates", () => {
  it("preserves secret values when the client omits them", () => {
    const existing = [{ key: "API_KEY", value: "keep-me", secret: true }];
    expect(
      mergeDeployEnvUpdates(existing, [
        { key: "API_KEY", value: "", secret: true, hasValue: true },
        { key: "PORT", value: "8080", secret: false },
      ]),
    ).toEqual([
      { key: "API_KEY", value: "keep-me", secret: true },
      { key: "PORT", value: "8080", secret: false },
    ]);
  });

  it("replaces secret values when a new value is provided", () => {
    const existing = [{ key: "API_KEY", value: "old", secret: true }];
    expect(
      mergeDeployEnvUpdates(existing, [
        { key: "API_KEY", value: "new", secret: true },
      ]),
    ).toEqual([{ key: "API_KEY", value: "new", secret: true }]);
  });

  it("clears secret values when hasValue is false", () => {
    const existing = [{ key: "API_KEY", value: "old", secret: true }];
    expect(
      mergeDeployEnvUpdates(existing, [
        { key: "API_KEY", value: "", secret: true, hasValue: false },
      ]),
    ).toEqual([{ key: "API_KEY", value: "", secret: true }]);
  });

  it("preserves value when unmasking with hasValue true and empty input", () => {
    const existing = [{ key: "API_KEY", value: "hidden", secret: true }];
    expect(
      mergeDeployEnvUpdates(existing, [
        { key: "API_KEY", value: "", secret: false, hasValue: true },
      ]),
    ).toEqual([{ key: "API_KEY", value: "hidden", secret: false }]);
  });

  it("infers secret flag from key name for new variables", () => {
    expect(
      mergeDeployEnvUpdates([], [
        { key: "FORGE_SESSION_SECRET", value: "s3cret", hasValue: true },
      ]),
    ).toEqual([
      { key: "FORGE_SESSION_SECRET", value: "s3cret", secret: true },
    ]);
  });
});

describe("resolveDeployEnvValue", () => {
  it("returns explicit value when provided", () => {
    expect(
      resolveDeployEnvValue({ key: "X", value: "new" }, {
        key: "X",
        value: "old",
        secret: true,
      }),
    ).toBe("new");
  });

  it("clears when hasValue is false", () => {
    expect(
      resolveDeployEnvValue(
        { key: "X", value: "", secret: true, hasValue: false },
        { key: "X", value: "old", secret: true },
      ),
    ).toBe("");
  });
});

describe("deployEnvToRecord", () => {
  it("maps keys to values", () => {
    expect(
      deployEnvToRecord([
        { key: "A", value: "1", secret: false },
        { key: "B", value: "2", secret: true },
      ]),
    ).toEqual({ A: "1", B: "2" });
  });
});
