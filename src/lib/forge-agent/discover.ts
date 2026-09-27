import { opsApiBaseUrl } from "@/lib/ops-api-auth";
import { forgeAgentEnvelope, forgeAgentSearchHref } from "@/lib/forge-agent/envelope";
import { FORGE_AGENT_PROTOCOL, MCP_PROTOCOL_VERSIONS } from "@/lib/forge-agent/types";

export function forgeAgentDiscoverDocument(baseUrl = opsApiBaseUrl()) {
  const origin = baseUrl.replace(/\/$/, "");
  return forgeAgentEnvelope({
    self: "/.well-known/forge-agent.json",
    search: forgeAgentSearchHref(),
    next: [
      {
        method: "GET",
        href: "/api/ops/discover",
        description: "Public protocol metadata and first authenticated steps",
        auth: "none",
      },
      {
        method: "GET",
        href: forgeAgentSearchHref(),
        description: "Search tools, resources, and prompts (schemas/names only)",
        auth: "none",
      },
      {
        method: "GET",
        href: "/api/ops/tools",
        description: "List tool schemas",
        auth: "none",
      },
      {
        method: "POST",
        href: "/api/ops/mcp",
        description: "MCP JSON-RPC 2.0 initialize, then tools/call with Ops bearer",
        auth: "none",
      },
      {
        method: "GET",
        href: "/api/ops",
        description: "Existing Ops catalog (live; Ops bearer required)",
        auth: "ops",
      },
    ],
    extra: {
      version: 1,
      name: "Forge Agent Control API",
      description:
        "Zero-knowledge discovery for Forge operations. Authenticate with an Ops bearer token, then search or call tools.",
      startHere: "/api/ops/discover",
      baseUrl: origin,
      transports: {
        http: {
          discover: "/api/ops/discover",
          search: "/api/ops/search?q=",
          tools: "/api/ops/tools",
          resources: "/api/ops/resources",
          prompts: "/api/ops/prompts",
          catalog: "/api/ops",
        },
        mcp: {
          url: "/api/ops/mcp",
          protocolVersions: [...MCP_PROTOCOL_VERSIONS],
          transport: "streamable-http",
        },
      },
      auth: {
        type: "bearer",
        header: "Authorization: Bearer $FORGE_OPS_API_TOKEN",
        alternateHeader: "X-Forge-Ops-Token: $FORGE_OPS_API_TOKEN",
        sessionHeader: "X-Forge-Agent-Session-Id: <session-id>",
        howTo:
          "Agents receive a project-scoped session token (fos.<sessionId>.) in FORGE_OPS_API_TOKEN. Optional global token grants full access for CI. Registered MCP functional users authenticate with an fmu.* secret. Well-known and discover leak no project data.",
      },
    },
  });
}

export function isPublicForgeAgentDocument(
  doc: ReturnType<typeof forgeAgentDiscoverDocument>,
): boolean {
  const blob = JSON.stringify(doc);
  return (
    doc.protocol === FORGE_AGENT_PROTOCOL &&
    !/"projectId"\s*:\s*"[0-9a-f-]{36}"/i.test(blob) &&
    !/fos\.[0-9a-f-]{8,}/i.test(blob)
  );
}
