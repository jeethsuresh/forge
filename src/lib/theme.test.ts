import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveEffectiveTheme } from "./theme";

describe("resolveEffectiveTheme", () => {
  it("maps light/dark directly", () => {
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
  });

  it("follows system when preference is system", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });
});

describe("parseThemePreference", () => {
  it("accepts known values and defaults to system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("nope")).toBe("system");
  });
});
