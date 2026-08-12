import { describe, expect, it } from "vitest";
import { runtimeTone, statusTone, toneBadgeClass } from "@/lib/ui-status";

describe("statusTone", () => {
  it("maps success and failure", () => {
    expect(statusTone("success")).toBe("success");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("running")).toBe("info");
    expect(statusTone("deploying")).toBe("warning");
  });
});

describe("runtimeTone", () => {
  it("maps runtime statuses", () => {
    expect(runtimeTone("running")).toBe("success");
    expect(runtimeTone("partial")).toBe("warning");
    expect(runtimeTone("stopped")).toBe("neutral");
  });
});

describe("toneBadgeClass", () => {
  it("includes colour tokens", () => {
    expect(toneBadgeClass("danger")).toContain("forge-tone-danger");
    expect(toneBadgeClass("accent")).toContain("forge-tone-accent");
  });
});
