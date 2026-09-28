import { describe, expect, it } from "vitest";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";
import {
  callableOpsPathSet,
  catalogOpsPathsRequiringTools,
  getForgeAgentPrompt,
  getForgeAgentTool,
  listForgeAgentPrompts,
  listForgeAgentResources,
  listForgeAgentTools,
  renderForgeAgentPrompt,
} from "@/lib/forge-agent/registry";

describe("forge-agent registry", () => {
  it("maps every current Ops catalog path to a callable tool", () => {
    const callable = callableOpsPathSet();
    for (const key of catalogOpsPathsRequiringTools()) {
      expect(callable.has(key), `missing callable tool for ${key}`).toBe(true);
    }
  });

  it("includes Ops rebase finalize and marks dashboard tools not callable", () => {
    expect(getForgeAgentTool("ops.projects.create")?.callable).toBe(true);
    expect(getForgeAgentTool("ops.projects.create")?.method).toBe("POST");

    const finalize = getForgeAgentTool("ops.project.git.rebase_finalize");
    expect(finalize?.callable).toBe(true);
    expect(finalize?.path).toBe(
      "/api/ops/projects/{projectId}/git-tree/rebase/finalize",
    );
    expect(finalize?.inputSchema.required).toEqual(
      expect.arrayContaining([
        "projectId",
        "actionDescription",
        "recoveryBranch",
        "sourceBranch",
      ]),
    );

    const dashboard = getForgeAgentTool("dashboard.project.compose");
    expect(dashboard?.callable).toBe(false);
    expect(dashboard?.auth).toBe("dashboard_cookie");

    const cookieFinalize = getForgeAgentTool(
      "dashboard.project.git_tree.rebase.finalize",
    );
    expect(cookieFinalize?.callable).toBe(false);
    expect(cookieFinalize?.path).toContain("/api/projects/");
  });

  it("exposes git smart HTTP as a resource, not a callable tool", () => {
    const git = listForgeAgentResources().find((item) => item.name === "git.smart_http");
    expect(git?.kind).toBe("git");
    expect(git?.uriTemplate).toBe("forge://git/{slug}");
    const catalog = forgeOpsApiCatalog("http://example.test");
    expect(catalog.endpoints.some((item) => item.path.includes("/api/git/"))).toBe(
      true,
    );
    expect(
      listForgeAgentTools().some(
        (tool) => tool.callable && tool.path.includes("/api/git/"),
      ),
    ).toBe(false);
  });

  it("includes v1 workflow prompts", () => {
    const names = listForgeAgentPrompts().map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "forge.deploy",
        "forge.rollback",
        "forge.check_status",
        "forge.rebase_recovery",
        "forge.forgefile_bootstrap",
      ]),
    );
    const rendered = renderForgeAgentPrompt(getForgeAgentPrompt("forge.deploy")!, {
      projectId: "proj-1",
    });
    expect(rendered).toContain("proj-1");
    expect(rendered.toLowerCase()).toContain("deploy");
    expect(rendered).toMatch(/never run \.\/deploy\.sh/i);
  });
});
