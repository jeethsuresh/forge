import { describe, expect, it } from "vitest";
import { secretsEqual } from "@/lib/secrets-equal";

describe("secretsEqual", () => {
  it("accepts identical secrets", () => {
    expect(secretsEqual("token-value", "token-value")).toBe(true);
  });

  it("rejects mismatched values and lengths", () => {
    expect(secretsEqual("token-value", "token-other")).toBe(false);
    expect(secretsEqual("short", "longer-secret")).toBe(false);
  });
});
