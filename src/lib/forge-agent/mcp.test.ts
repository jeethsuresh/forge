import { describe, expect, it } from "vitest";
import { handleMcpJsonRpc } from "@/lib/forge-agent/mcp";
import { callForgeAgentTool, denyDashboardOrUncallable, validateToolArguments } from "@/lib/forge-agent/dispatch";
import { getForgeAgentTool } from "@/lib/forge-agent/registry";
import { MCP_PROTOCOL_VERSION } from "@/lib/forge-agent/types";

async function rpc(body: unknown, headers?: HeadersInit) {
  const request = new Request("http://127.0.0.1:3000/api/ops/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return handleMcpJsonRpc(request, body);
}

describe("forge-agent MCP", () => {
  it("initializes without auth and lists tools", async () => {
    const init = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(initBody.result.protocolVersion).toBe("2025-03-26");
    expect(initBody.result.serverInfo.name).toBe("forge-agent");

    const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listBody = (await listed.json()) as {
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };
    const names = listBody.result.tools.map((tool) => tool.name);
    expect(names).toContain("ops.project.deploy");
    expect(names).toContain("dashboard.project.compose");
    expect(
      listBody.result.tools.find((tool) => tool.name === "ops.project.deploy")?.inputSchema,
    ).toBeTruthy();
  });

  it("rejects tools/call without Ops auth", async () => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "ops.project.deploy",
        arguments: {
          projectId: "proj-1",
          actionDescription: "Deploying after tests passed on main.",
        },
      },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32001);
  });

  it("returns default protocol version 2025-06-18", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 4, method: "initialize", params: {} });
    const body = (await response.json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });
});

describe("forge-agent dispatch guards", () => {
  it("refuses dashboard tools before hitting Ops", () => {
    const tool = getForgeAgentTool("dashboard.project.compose")!;
    const denied = denyDashboardOrUncallable(tool);
    expect(denied?.status).toBe(403);
  });

  it("requires actionDescription on deploy", () => {
    const tool = getForgeAgentTool("ops.project.deploy")!;
    expect(validateToolArguments(tool, { projectId: "p" })).toMatch(/actionDescription/);
    expect(
      validateToolArguments(tool, {
        projectId: "p",
        actionDescription: "Deploying main after tests passed.",
      }),
    ).toBeNull();
  });

  it("returns 404 for unknown tools", async () => {
    const response = await callForgeAgentTool({
      name: "ops.nope",
      args: {},
      request: new Request("http://127.0.0.1/api/ops/tools/ops.nope/call", { method: "POST" }),
    });
    expect(response.status).toBe(404);
  });
});
