import { describe, expect, it } from "vitest";
import { forgeOpsApiCatalog } from "@/lib/agent-ops-prompt";
import { getForgeAgentTool } from "@/lib/forge-agent/registry";
import { isBootstrapOpsPathAllowed } from "@/lib/ops-bootstrap-guard";

describe("ticket ops catalog", () => {
  it("includes ticket list, claim, complete, followup, and queue endpoints", () => {
    const catalog = forgeOpsApiCatalog("http://example.test");
    const paths = catalog.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(paths).toContain("GET /api/ops/projects/{projectId}/tickets");
    expect(paths).toContain("POST /api/ops/projects/{projectId}/tickets/{ticketId}/pickup");
    expect(paths).toContain("POST /api/ops/projects/{projectId}/tickets/{ticketId}/complete");
    expect(paths).toContain("POST /api/ops/projects/{projectId}/tickets/{ticketId}/followup");
    expect(paths).toContain("GET /api/ops/tickets/queue");
    expect(paths).toContain("PATCH /api/ops/tickets/queue");
    expect(paths).toContain("POST /api/ops/tickets/claim-next");
  });

  it("registers callable tools for ticket pickup and queue reorder", () => {
    expect(getForgeAgentTool("ops.project.ticket.pickup")?.callable).toBe(true);
    expect(getForgeAgentTool("ops.tickets.queue.patch")?.inputSchema.required).toEqual(
      expect.arrayContaining(["actionDescription", "orderedIds"]),
    );
    expect(getForgeAgentTool("dashboard.settings.ticket_queue")?.callable).toBe(false);
  });

  it("allows ticket ops during forgefile bootstrap", () => {
    expect(
      isBootstrapOpsPathAllowed(
        "POST",
        "/api/ops/projects/abc/tickets/t1/complete",
      ),
    ).toBe(true);
    expect(isBootstrapOpsPathAllowed("GET", "/api/ops/tickets")).toBe(true);
  });
});
