import { describe, expect, it } from "vitest";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";

describe("forgefile ops catalog", () => {
  it("includes forgefile status and script run endpoints", () => {
    const catalog = forgeOpsApiCatalog("http://example.test");
    const paths = catalog.endpoints.map((e) => e.path);
    expect(paths).toContain("/api/ops/projects/{projectId}/forgefile");
    expect(paths).toContain("/api/ops/projects/{projectId}/scripts/{name}/run");

    const deploy = catalog.endpoints.find(
      (e) => e.path === "/api/ops/projects/{projectId}/deploy",
    );
    expect(deploy?.body).toMatchObject({
      deployment: expect.stringMatching(/deploy target/i),
    });
  });
});
