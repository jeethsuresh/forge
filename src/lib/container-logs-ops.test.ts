import { describe, expect, it } from "vitest";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";

describe("container logs ops catalog", () => {
  it("includes GET container logs", () => {
    const catalog = forgeOpsApiCatalog("http://example.test");
    const paths = catalog.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(paths).toContain(
      "GET /api/ops/projects/{projectId}/containers/{containerName}/logs",
    );

    const endpoint = catalog.endpoints.find(
      (e) =>
        e.path ===
        "/api/ops/projects/{projectId}/containers/{containerName}/logs",
    );
    expect(endpoint?.method).toBe("GET");
    expect(endpoint?.description).toMatch(/docker logs/i);
  });
});
