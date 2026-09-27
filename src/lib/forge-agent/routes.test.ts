import { describe, expect, it } from "vitest";
import { GET as wellKnownGet } from "@/app/.well-known/forge-agent.json/route";
import { GET as discoverGet } from "@/app/api/ops/discover/route";
import { GET as searchGet } from "@/app/api/ops/search/route";
import { GET as toolsGet } from "@/app/api/ops/tools/route";
import { GET as mcpGet, POST as mcpPost } from "@/app/api/ops/mcp/route";
import { FORGE_AGENT_PROTOCOL } from "@/lib/forge-agent/types";

describe("forge-agent public routes", () => {
  it("serves well-known and discover without auth", async () => {
    const wellKnown = await wellKnownGet();
    expect(wellKnown.status).toBe(200);
    const doc = (await wellKnown.json()) as {
      protocol: string;
      startHere: string;
      transports: { mcp: { url: string } };
    };
    expect(doc.protocol).toBe(FORGE_AGENT_PROTOCOL);
    expect(doc.startHere).toBe("/api/ops/discover");
    expect(doc.transports.mcp.url).toBe("/api/ops/mcp");

    const discover = await discoverGet();
    const discoverDoc = (await discover.json()) as { protocol: string; self: string };
    expect(discoverDoc.protocol).toBe(FORGE_AGENT_PROTOCOL);
    expect(discoverDoc.self).toBe("/api/ops/discover");
  });

  it("searches tools without auth and rejects MCP GET", async () => {
    const search = await searchGet(
      new Request("http://127.0.0.1/api/ops/search?q=deploy"),
    );
    const searchBody = (await search.json()) as {
      hits: Array<{ name: string }>;
    };
    expect(searchBody.hits.some((hit) => hit.name.includes("deploy"))).toBe(true);

    const tools = await toolsGet(new Request("http://127.0.0.1/api/ops/tools?q=rollback"));
    const toolsBody = (await tools.json()) as { tools: Array<{ name: string }> };
    expect(toolsBody.tools.some((tool) => tool.name.includes("rollback"))).toBe(true);

    const mcp = await mcpGet();
    expect(mcp.status).toBe(405);
  });

  it("accepts MCP initialize over the route", async () => {
    const response = await mcpPost(
      new Request("http://127.0.0.1/api/ops/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("forge-agent");
  });
});
