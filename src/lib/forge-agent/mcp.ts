import { NextResponse } from "next/server";
import { authenticateOpsRequest } from "@/lib/ops-api-auth";
import { callForgeAgentTool, readForgeAgentResource } from "@/lib/forge-agent/dispatch";
import {
  getForgeAgentPrompt,
  getForgeAgentTool,
  listForgeAgentPrompts,
  listForgeAgentResources,
  listForgeAgentTools,
  renderForgeAgentPrompt,
} from "@/lib/forge-agent/registry";
import { MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS } from "@/lib/forge-agent/types";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

export const MCP_UNAUTHENTICATED_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
]);

function jsonRpcResult(id: JsonRpcId, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { status });
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  status = 400,
) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } },
    { status },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mcpTool(tool: ReturnType<typeof listForgeAgentTools>[number]) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    _meta: { callable: tool.callable, auth: tool.auth, path: tool.path, method: tool.method },
  };
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return { status: response.status };
  try {
    return JSON.parse(text);
  } catch {
    return { status: response.status, text };
  }
}

export async function handleMcpJsonRpc(
  request: Request,
  raw: unknown,
): Promise<Response> {
  if (Array.isArray(raw)) {
    const parts = await Promise.all(raw.map((item) => handleMcpJsonRpc(request, item)));
    const bodies = await Promise.all(parts.map((part) => part.json()));
    return NextResponse.json(bodies);
  }

  if (!raw || typeof raw !== "object") {
    return jsonRpcError(null, -32600, "Invalid Request", undefined, 400);
  }

  const body = raw as JsonRpcRequest;
  const id = body.id ?? null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError(id, -32600, "Invalid Request");
  }

  const method = body.method;
  const params = asRecord(body.params);

  if (method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 204 });
  }

  const needsAuth = !MCP_UNAUTHENTICATED_METHODS.has(method);
  if (needsAuth && !authenticateOpsRequest(request)) {
    return jsonRpcError(id, -32001, "Unauthorized", { next: "Send Authorization: Bearer $FORGE_OPS_API_TOKEN" }, 401);
  }

  switch (method) {
    case "initialize": {
      const requested =
        typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION;
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_PROTOCOL_VERSION;
      return jsonRpcResult(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: "forge-agent", version: "1" },
        instructions:
          "Authenticate tools/call and live resource reads with Authorization: Bearer $FORGE_OPS_API_TOKEN. Discover HTTP explorer at GET /.well-known/forge-agent.json.",
      });
    }
    case "ping":
      return jsonRpcResult(id, {});
    case "tools/list":
      return jsonRpcResult(id, { tools: listForgeAgentTools().map(mcpTool) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = asRecord(params.arguments);
      if (!name) return jsonRpcError(id, -32602, "Invalid params", { field: "name" });
      const tool = getForgeAgentTool(name);
      if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${name}`, undefined, 404);
      const response = await callForgeAgentTool({ name, args, request });
      const payload = await responseJson(response);
      const isError = response.status >= 400;
      return jsonRpcResult(
        id,
        {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError,
        },
        isError ? response.status : 200,
      );
    }
    case "resources/list":
      return jsonRpcResult(id, {
        resources: listForgeAgentResources().map((item) => ({
          uri: item.uriTemplate,
          name: item.name,
          description: item.description,
          mimeType: item.mimeType,
        })),
      });
    case "resources/templates/list":
      return jsonRpcResult(id, {
        resourceTemplates: listForgeAgentResources().map((item) => ({
          uriTemplate: item.uriTemplate,
          name: item.name,
          description: item.description,
        })),
      });
    case "resources/read": {
      const uri = typeof params.uri === "string" ? params.uri : "";
      if (!uri) return jsonRpcError(id, -32602, "Invalid params", { field: "uri" });
      const args = asRecord(params.arguments);
      const response = await readForgeAgentResource({
        nameOrUri: uri,
        args,
        request,
      });
      const payload = await responseJson(response);
      if (response.status >= 400) {
        return jsonRpcError(id, response.status === 401 ? -32001 : -32602, "resources/read failed", payload, response.status);
      }
      return jsonRpcResult(id, {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(payload),
          },
        ],
      });
    }
    case "prompts/list":
      return jsonRpcResult(id, {
        prompts: listForgeAgentPrompts().map((item) => ({
          name: item.name,
          description: item.description,
          arguments: item.arguments,
        })),
      });
    case "prompts/get": {
      const name = typeof params.name === "string" ? params.name : "";
      const prompt = getForgeAgentPrompt(name);
      if (!prompt) return jsonRpcError(id, -32602, `Unknown prompt: ${name}`, undefined, 404);
      const argMap: Record<string, string> = {};
      const rawArgs = asRecord(params.arguments);
      for (const [key, value] of Object.entries(rawArgs)) {
        if (value != null) argMap[key] = String(value);
      }
      return jsonRpcResult(id, {
        description: prompt.description,
        messages: [
          {
            role: "user",
            content: { type: "text", text: renderForgeAgentPrompt(prompt, argMap) },
          },
        ],
      });
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`, undefined, 404);
  }
}

