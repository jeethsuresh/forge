import { describe, expect, it } from "vitest";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";

describe("artifact ops catalog", () => {
  it("includes artifact list, build, and download endpoints", () => {
    const catalog = forgeOpsApiCatalog("http://example.test");
    const paths = catalog.endpoints.map((e) => `${e.method} ${e.path}`);

    expect(paths).toContain("GET /api/ops/projects/{projectId}/artifacts");
    expect(paths).toContain(
      "POST /api/ops/projects/{projectId}/artifacts/{name}/build",
    );
    expect(paths).toContain(
      "GET /api/ops/projects/{projectId}/artifacts/{name}/builds/{buildId}/download",
    );

    const build = catalog.endpoints.find(
      (e) =>
        e.method === "POST" &&
        e.path === "/api/ops/projects/{projectId}/artifacts/{name}/build",
    );
    expect(build?.body).toMatchObject({
      actionDescription: "string (required)",
    });
  });
});
