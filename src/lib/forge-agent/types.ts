export const FORGE_AGENT_PROTOCOL = "forge-agent/1" as const;
export const MCP_PROTOCOL_VERSION = "2025-06-18" as const;
export const MCP_PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18"] as const;

export type ForgeAgentAuth = "none" | "ops" | "dashboard_cookie";
export type ForgeAgentKind = "ops" | "dashboard" | "git";

export type ForgeAgentNext = {
  method: string;
  href: string;
  description: string;
  auth?: ForgeAgentAuth;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ForgeAgentTool = {
  name: string;
  description: string;
  tags: string[];
  method: string;
  path: string;
  callable: boolean;
  auth: ForgeAgentAuth;
  kind: ForgeAgentKind;
  inputSchema: JsonSchema;
};

export type ForgeAgentResource = {
  name: string;
  uriTemplate: string;
  description: string;
  tags: string[];
  mimeType: string;
  auth: ForgeAgentAuth;
  kind: ForgeAgentKind;
  live: boolean;
  readTool?: string;
};

export type ForgeAgentPromptArgument = {
  name: string;
  description: string;
  required: boolean;
};

export type ForgeAgentPrompt = {
  name: string;
  description: string;
  tags: string[];
  arguments: ForgeAgentPromptArgument[];
  template: string;
};

export type SearchableItem = {
  kind: "tool" | "resource" | "prompt";
  name: string;
  description: string;
  tags: string[];
  path?: string;
  uriTemplate?: string;
  callable?: boolean;
  auth?: ForgeAgentAuth;
};

export type RankedSearchHit = SearchableItem & { score: number };
