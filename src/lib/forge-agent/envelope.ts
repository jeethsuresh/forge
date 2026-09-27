import {
  FORGE_AGENT_PROTOCOL,
  type ForgeAgentNext,
} from "@/lib/forge-agent/types";

export function forgeAgentSearchHref(query = ""): string {
  return query
    ? `/api/ops/search?q=${encodeURIComponent(query)}`
    : "/api/ops/search?q=";
}

export function forgeAgentEnvelope<T extends Record<string, unknown>>(input: {
  self: string;
  search?: string;
  next: ForgeAgentNext[];
  extra?: T;
}): T & {
  protocol: typeof FORGE_AGENT_PROTOCOL;
  self: string;
  search: string;
  next: ForgeAgentNext[];
} {
  return {
    ...(input.extra ?? ({} as T)),
    protocol: FORGE_AGENT_PROTOCOL,
    self: input.self,
    search: input.search ?? forgeAgentSearchHref(),
    next: input.next,
  };
}

export function explorerCollectionNext(kind: "tools" | "resources" | "prompts"): ForgeAgentNext[] {
  return [
    {
      method: "GET",
      href: "/api/ops/search?q=",
      description: "Search tools, resources, and prompts",
      auth: "none",
    },
    {
      method: "GET",
      href: `/api/ops/${kind}`,
      description: `List ${kind}`,
      auth: "none",
    },
    {
      method: "POST",
      href: "/api/ops/mcp",
      description: "MCP JSON-RPC 2.0 (Streamable HTTP)",
      auth: "none",
    },
  ];
}
