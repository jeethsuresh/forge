"use client";

import { useMemo, useState } from "react";
import type { AgentDisplayItem, AgentDisplayMessage } from "@/lib/agent-stream";
import { groupMessagesForDisplay, summarizeToolCluster } from "@/lib/agent-stream";

export function AgentMessageList({
  messages,
}: {
  messages: AgentDisplayMessage[];
}) {
  const items = useMemo(() => groupMessagesForDisplay(messages), [messages]);

  return (
    <>
      {items.map((item) =>
        item.kind === "tool-cluster" ? (
          <ToolCluster key={item.id} cluster={item} />
        ) : item.message.role === "tool" ? (
          <ToolOperation key={item.message.id} message={item.message} />
        ) : (
          <MessageBubble key={item.message.id} message={item.message} />
        ),
      )}
    </>
  );
}

function ToolCluster({
  cluster,
}: {
  cluster: Extract<AgentDisplayItem, { kind: "tool-cluster" }>;
}) {
  const [manualState, setManualState] = useState<"expanded" | "collapsed" | null>(
    null,
  );
  const expanded =
    manualState === "expanded"
      ? true
      : manualState === "collapsed"
        ? false
        : cluster.hasActive;

  const count = cluster.tools.length;
  const summary = summarizeToolCluster(cluster.tools);

  return (
    <div
      className={`rounded-lg border text-xs ${
        cluster.hasActive
          ? "border-amber-400/20 bg-amber-400/5"
          : "border-zinc-800 bg-zinc-950/50"
      }`}
    >
      <button
        type="button"
        onClick={() =>
          setManualState(expanded ? "collapsed" : "expanded")
        }
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/40"
      >
        <Chevron expanded={expanded} />
        <span className="font-medium text-zinc-300">
          {count} tool {count === 1 ? "call" : "calls"}
          {cluster.hasActive && (
            <span className="ml-1.5 text-amber-400/90">running</span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-zinc-500">
          {summary}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-zinc-800/80 px-2 py-2">
          {cluster.tools.map((tool) => (
            <ToolOperation key={tool.id} message={tool} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolOperation({
  message,
  nested = false,
}: {
  message: AgentDisplayMessage;
  nested?: boolean;
}) {
  const busy = message.toolStatus === "started";
  const [expanded, setExpanded] = useState(false);
  const icon = toolIcon(message.toolName);
  const label = formatToolLabel(message);

  if (nested) {
    return (
      <div
        className={`flex items-start gap-2 rounded-md px-2 py-1.5 font-mono ${
          busy ? "text-amber-200/80" : "text-zinc-500"
        }`}
      >
        <span className="mt-0.5 shrink-0">{statusIcon(message.toolStatus)}</span>
        <span className="shrink-0 text-zinc-600">{icon}</span>
        <span className="min-w-0 break-all">{label}</span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border text-xs ${
        busy
          ? "border-amber-400/20 bg-amber-400/5 text-amber-200/80"
          : "border-zinc-800 bg-zinc-950/50 text-zinc-500"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-zinc-900/40"
      >
        <Chevron expanded={expanded} className="mt-0.5" />
        <span className="mt-0.5 shrink-0">{statusIcon(message.toolStatus)}</span>
        <span className="mt-0.5 shrink-0 text-zinc-600">{icon}</span>
        <span className="min-w-0 flex-1 break-all font-mono">{label}</span>
      </button>
      {expanded && message.content !== label && (
        <pre className="border-t border-zinc-800/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-600">
          {message.content}
        </pre>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: AgentDisplayMessage }) {
  if (message.role === "system") {
    return (
      <p className="text-center text-xs text-zinc-600">{message.content}</p>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] ${
          isUser
            ? "bg-orange-500/20 text-orange-100"
            : "bg-zinc-800 text-zinc-200"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}

function Chevron({
  expanded,
  className = "",
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block shrink-0 text-zinc-600 transition-transform ${expanded ? "rotate-90" : ""} ${className}`}
      aria-hidden
    >
      ▸
    </span>
  );
}

function statusIcon(status?: "started" | "completed"): string {
  if (status === "completed") return "✓";
  if (status === "started") return "…";
  return "·";
}

function toolIcon(toolName?: string): string {
  switch (toolName?.toLowerCase()) {
    case "read":
      return "R";
    case "write":
    case "edit":
      return "W";
    case "shell":
      return "$";
    case "grep":
    case "search":
      return "?";
    case "delete":
      return "×";
    default:
      return "⚙";
  }
}

function formatToolLabel(message: AgentDisplayMessage): string {
  const name = message.toolName ?? "tool";
  const path = message.content.includes(": ")
    ? message.content.slice(message.content.indexOf(": ") + 2)
    : "";
  return path ? `${name}: ${path}` : message.content;
}
