import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";
import { randomUUID } from "crypto";

export type LocalLoopEmit = (line: string) => void;

export type LocalLoopOptions = {
  prompt: string;
  workdir: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  opsBaseUrl?: string;
  opsToken?: string;
  projectId?: string;
  sessionId?: string;
  emit: LocalLoopEmit;
  fetchImpl?: typeof fetch;
  maxSteps?: number;
  depth?: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 file relative to the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 file relative to the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          contents: { type: "string" },
        },
        required: ["path", "contents"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace one occurrence of old_string with new_string in a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a shell command in the workspace. No docker/podman sockets.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git",
      description: "Run a git subcommand (status, diff, add, commit, log).",
      parameters: {
        type: "object",
        properties: {
          args: { type: "array", items: { type: "string" } },
        },
        required: ["args"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ops_http",
      description: "Call Forge Ops HTTP with the session token.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string" },
          path: { type: "string" },
          body: { type: "object" },
        },
        required: ["method", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser",
      description: "Open a URL with Playwright and return title plus text snapshot.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mcp_call",
      description: "JSON-RPC call to Forge Ops MCP.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string" },
          params: { type: "object" },
        },
        required: ["method"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_subagent",
      description: "Run a nested local agent on the same workspace with a short prompt.",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string" } },
        required: ["prompt"],
      },
    },
  },
] as const;

function emitJson(emit: LocalLoopEmit, event: Record<string, unknown>): void {
  emit(JSON.stringify(event));
}

function safePath(workdir: string, input: string): string {
  const resolved = isAbsolute(input) ? resolve(input) : resolve(workdir, input);
  const rel = relative(workdir, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${input}`);
  }
  return resolved;
}

function looksLikeSocket(command: string): boolean {
  const lower = command.toLowerCase();
  return (
    lower.includes("docker.sock") ||
    lower.includes("podman.sock") ||
    lower.includes("docker.sock")
  );
}

export function isReasoningUnsupportedError(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /reasoning|unknown field|unexpected keyword/i.test(body);
}

export async function completeChat(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  messages: ChatMessage[];
  fetchImpl: typeof fetch;
  effort?: "xhigh" | "high";
}): Promise<{
  status: number;
  body: string;
  json: Record<string, unknown> | null;
}> {
  const url = `${input.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    tools: TOOLS,
    tool_choice: "auto",
  };
  if (input.effort) {
    payload.reasoning_effort = input.effort;
    payload.reasoning = { effort: input.effort };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
  const res = await input.fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(body) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, body, json };
}

async function runBrowser(url: string): Promise<string> {
  try {
    // Optional agent-image dependency; host unit tests do not install Playwright.
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const title = await page.title();
    const text = await page.locator("body").innerText();
    await browser.close();
    return JSON.stringify({ title, text: text.slice(0, 8000) });
  } catch (err) {
    return `Browser unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function runTool(
  name: string,
  rawArgs: string,
  opts: LocalLoopOptions,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return "Invalid tool arguments JSON";
  }
  const workdir = opts.workdir;
  try {
    switch (name) {
      case "read_file": {
        const path = safePath(workdir, String(args.path ?? ""));
        return readFileSync(path, "utf8");
      }
      case "write_file": {
        const path = safePath(workdir, String(args.path ?? ""));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, String(args.contents ?? ""), "utf8");
        return `Wrote ${path}`;
      }
      case "edit_file": {
        const path = safePath(workdir, String(args.path ?? ""));
        const current = readFileSync(path, "utf8");
        const oldString = String(args.old_string ?? "");
        if (!current.includes(oldString)) {
          return "old_string not found";
        }
        writeFileSync(
          path,
          current.replace(oldString, String(args.new_string ?? "")),
          "utf8",
        );
        return `Edited ${path}`;
      }
      case "run_shell": {
        const command = String(args.command ?? "");
        if (looksLikeSocket(command)) {
          return "Refusing command that targets a container runtime socket";
        }
        const result = spawnSync("bash", ["-lc", command], {
          cwd: workdir,
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        return [
          result.stdout,
          result.stderr,
          `exit ${result.status ?? 1}`,
        ]
          .filter(Boolean)
          .join("\n");
      }
      case "git": {
        const gitArgs = Array.isArray(args.args)
          ? args.args.map((a) => String(a))
          : [];
        const result = spawnSync("git", gitArgs, {
          cwd: workdir,
          encoding: "utf8",
          timeout: 60_000,
        });
        return [result.stdout, result.stderr, `exit ${result.status ?? 1}`]
          .filter(Boolean)
          .join("\n");
      }
      case "ops_http": {
        if (!opts.opsBaseUrl || !opts.opsToken) return "Ops credentials missing";
        const method = String(args.method ?? "GET").toUpperCase();
        const path = String(args.path ?? "/");
        const url = `${opts.opsBaseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${opts.opsToken}`,
          "Content-Type": "application/json",
        };
        if (opts.sessionId) {
          headers["X-Forge-Agent-Session-Id"] = opts.sessionId;
        }
        const res = await (opts.fetchImpl ?? fetch)(url, {
          method,
          headers,
          body:
            method === "GET" || method === "HEAD"
              ? undefined
              : JSON.stringify({
                  actionDescription: "Local agent Ops call for the current session.",
                  ...(args.body && typeof args.body === "object"
                    ? (args.body as Record<string, unknown>)
                    : {}),
                }),
        });
        return `${res.status} ${await res.text()}`;
      }
      case "browser":
        return runBrowser(String(args.url ?? ""));
      case "mcp_call": {
        if (!opts.opsBaseUrl || !opts.opsToken) return "Ops credentials missing";
        const url = `${opts.opsBaseUrl.replace(/\/$/, "")}/api/ops/mcp`;
        const res = await (opts.fetchImpl ?? fetch)(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.opsToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: randomUUID(),
            method: String(args.method ?? "tools/list"),
            params: args.params ?? {},
          }),
        });
        return await res.text();
      }
      case "spawn_subagent": {
        const depth = opts.depth ?? 0;
        if (depth >= 2) return "Subagent depth cap reached";
        const nested: string[] = [];
        await runLocalAgentLoop({
          ...opts,
          prompt: String(args.prompt ?? ""),
          maxSteps: 12,
          depth: depth + 1,
          emit: (line) => nested.push(line),
        });
        return nested.slice(-20).join("\n");
      }
      default:
        return `Unknown tool ${name}`;
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function runLocalAgentLoop(opts: LocalLoopOptions): Promise<number> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sessionId = opts.sessionId || randomUUID();
  const maxSteps = opts.maxSteps ?? 40;
  opts.emit(
    JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: sessionId,
    }),
  );

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a Forge local coding agent. Work in the git workspace. Prefer extra-high reasoning. Use tools to edit files, run commands, call Forge Ops, browse, and spawn subagents when needed. Stop when the task is done.",
    },
    { role: "user", content: opts.prompt },
  ];

  let effort: "xhigh" | "high" | undefined = "xhigh";
  let thinkingLogged = false;

  for (let step = 0; step < maxSteps; step += 1) {
    let result = await completeChat({
      baseUrl: opts.baseUrl,
      model: opts.model,
      apiKey: opts.apiKey,
      messages,
      fetchImpl,
      effort,
    });
    if (effort && isReasoningUnsupportedError(result.status, result.body)) {
      if (effort === "xhigh") {
        effort = "high";
        if (!thinkingLogged) {
          emitJson(opts.emit, {
            type: "system",
            subtype: "info",
            text: "Local model rejected xhigh reasoning; retrying with high.",
          });
          thinkingLogged = true;
        }
        result = await completeChat({
          baseUrl: opts.baseUrl,
          model: opts.model,
          apiKey: opts.apiKey,
          messages,
          fetchImpl,
          effort,
        });
      }
      if (isReasoningUnsupportedError(result.status, result.body)) {
        effort = undefined;
        emitJson(opts.emit, {
          type: "system",
          subtype: "info",
          text: "thinking=none (model does not support reasoning)",
        });
        result = await completeChat({
          baseUrl: opts.baseUrl,
          model: opts.model,
          apiKey: opts.apiKey,
          messages,
          fetchImpl,
        });
      }
    }
    if (result.status >= 400 || !result.json) {
      emitJson(opts.emit, {
        type: "system",
        subtype: "error",
        text: result.body || `HTTP ${result.status}`,
      });
      return 1;
    }
    const choices = result.json.choices;
    const message =
      Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
        ? ((choices[0] as { message?: ChatMessage }).message ?? null)
        : null;
    if (!message) {
      emitJson(opts.emit, {
        type: "system",
        subtype: "error",
        text: "Local model returned no message",
      });
      return 1;
    }
    const text =
      typeof message.content === "string" ? message.content : "";
    if (text) {
      emitJson(opts.emit, {
        type: "assistant",
        message: { content: [{ type: "text", text }] },
      });
    }
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return 0;
    }
    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        parsedArgs = {};
      }
      emitJson(opts.emit, {
        type: "tool_call",
        subtype: "started",
        call_id: call.id,
        tool_call: {
          [`${call.function.name}ToolCall`]: {
            args: parsedArgs,
          },
        },
      });
      const output = await runTool(call.function.name, call.function.arguments, opts);
      emitJson(opts.emit, {
        type: "tool_call",
        subtype: "completed",
        call_id: call.id,
        tool_call: {
          [`${call.function.name}ToolCall`]: {
            args: parsedArgs,
            result: { success: { content: output } },
          },
        },
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }
  }
  emitJson(opts.emit, {
    type: "system",
    subtype: "error",
    text: "Local agent hit the step cap",
  });
  return 1;
}

export async function mainFromEnv(): Promise<number> {
  const workdir = process.env.FORGE_AGENT_WORKDIR || process.cwd();
  const promptFile = process.env.FORGE_AGENT_PROMPT_FILE;
  const prompt = promptFile && existsSync(promptFile)
    ? readFileSync(promptFile, "utf8")
    : process.argv.slice(2).join(" ") || "Continue the Forge agent session.";
  const baseUrl = process.env.FORGE_LOCAL_BASE_URL?.trim();
  const model = process.env.FORGE_LOCAL_MODEL?.trim();
  if (!baseUrl || !model) {
    process.stderr.write("FORGE_LOCAL_BASE_URL and FORGE_LOCAL_MODEL are required\n");
    return 2;
  }
  return runLocalAgentLoop({
    prompt,
    workdir,
    baseUrl,
    model,
    apiKey: process.env.FORGE_LOCAL_API_KEY,
    opsBaseUrl: process.env.FORGE_OPS_API_BASE,
    opsToken: process.env.FORGE_OPS_API_TOKEN,
    projectId: process.env.FORGE_AGENT_PROJECT_ID,
    sessionId: process.env.FORGE_AGENT_SESSION_ID,
    emit: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("local-loop.ts") || entry.endsWith("local-loop.js")) {
  void mainFromEnv().then((code) => process.exit(code));
}
