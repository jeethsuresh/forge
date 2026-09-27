import { describe, expect, it } from "vitest";
import { forgeAgentDiscoverDocument, isPublicForgeAgentDocument } from "@/lib/forge-agent/discover";
import { forgeAgentEnvelope } from "@/lib/forge-agent/envelope";
import { FORGE_AGENT_PROTOCOL } from "@/lib/forge-agent/types";
import { rankForgeAgentHits } from "@/lib/forge-agent/search";
import { searchableForgeAgentItems } from "@/lib/forge-agent/registry";

describe("forge-agent envelope", () => {
  it("always includes protocol, self, search, and next", () => {
    const body = forgeAgentEnvelope({
      self: "/api/ops/tools",
      next: [
        {
          method: "GET",
          href: "/api/ops/search?q=deploy",
          description: "Search",
        },
      ],
      extra: { tools: [] },
    });
    expect(body.protocol).toBe(FORGE_AGENT_PROTOCOL);
    expect(body.self).toBe("/api/ops/tools");
    expect(body.search).toBe("/api/ops/search?q=");
    expect(body.next[0]?.href).toContain("search");
    expect(body.tools).toEqual([]);
  });
});

describe("forge-agent search", () => {
  it("ranks deploy above unrelated tools and requires every token", () => {
    const hits = rankForgeAgentHits("deploy", searchableForgeAgentItems());
    expect(hits[0]?.name).toMatch(/deploy/);
    expect(hits.every((hit) => hit.score > 0)).toBe(true);

    const none = rankForgeAgentHits("deploy xyzzy-no-such-token", searchableForgeAgentItems());
    expect(none).toEqual([]);
  });

  it("finds dashboard-only surfaces without making them callable", () => {
    const hits = rankForgeAgentHits("compose studio", searchableForgeAgentItems());
    const compose = hits.find((hit) => hit.name.includes("compose"));
    expect(compose).toBeTruthy();
    if (compose?.kind === "tool") {
      expect(compose.callable).toBe(false);
      expect(compose.auth).toBe("dashboard_cookie");
    }
  });
});

describe("forge-agent discover", () => {
  it("is public protocol metadata with both transports", () => {
    const doc = forgeAgentDiscoverDocument("http://example.test");
    expect(isPublicForgeAgentDocument(doc)).toBe(true);
    expect(doc.startHere).toBe("/api/ops/discover");
    expect(doc.transports.http.tools).toBe("/api/ops/tools");
    expect(doc.transports.mcp.url).toBe("/api/ops/mcp");
    expect(doc.next.length).toBeGreaterThan(0);
    expect(JSON.stringify(doc)).toMatch(/fmu\./);
  });
});
