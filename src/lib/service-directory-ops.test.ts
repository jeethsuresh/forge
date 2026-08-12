import { describe, expect, it } from "vitest";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";

describe("service directory ops catalog", () => {
  it("includes GET /api/ops/services", () => {
    const catalog = forgeOpsApiCatalog("http://example.test");
    const paths = catalog.endpoints.map((e) => e.path);
    expect(paths).toContain("/api/ops/services");

    const services = catalog.endpoints.find((e) => e.path === "/api/ops/services");
    expect(services?.method).toBe("GET");
    expect(services?.description).toMatch(/service directory/i);
  });
});
