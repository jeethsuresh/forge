"use client";

import { useMemo, useState } from "react";
import type { AgentDisplayItem, AgentDisplayMessage } from "@/lib/agent-stream";
import {
  formatToolArgs,
  formatToolDuration,
  groupMessagesForDisplay,
  summarizeToolCluster,
  toolStatusLabel,
} from "@/lib/agent-stream";
import { ShellToolOutput } from "@/components/ShellToolOutput";

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
  const completedCount = cluster.tools.filter(
    (t) => t.toolStatus === "completed",
  ).length;

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
          {cluster.hasActive ? (
            <span className="ml-1.5 text-amber-400/90">running</span>
          ) : (
            <span className="ml-1.5 text-zinc-500">
              completed{completedCount > 0 ? ` (${completedCount})` : ""}
            </span>
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
  const isShell = message.toolName?.toLowerCase() === "shell";
  const status = toolStatusLabel(message);
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? (busy || isShell);
  const icon = toolIcon(message.toolName);
  const label = formatToolLabel(message);
  const duration = formatToolDuration(message.toolDurationMs);
  const hasShellOutput = isShell && (
    busy ||
    Boolean(message.toolStdout || message.toolStderr)
  );
  const hasDetails = Boolean(
    message.toolArgs ||
      message.toolResultText ||
      message.toolError ||
      duration ||
      hasShellOutput,
  );

  if (nested) {
    return (
      <div
        className={`rounded-md px-2 py-1.5 font-mono ${
          busy
            ? "text-amber-200/80"
            : message.toolError
              ? "text-red-400/80"
              : "text-zinc-500"
        }`}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">{statusIcon(message)}</span>
          <span className="shrink-0 text-zinc-600">{icon}</span>
          <span className="min-w-0 flex-1 break-all">{label}</span>
          <span
            className={`shrink-0 text-[10px] uppercase tracking-wide ${
              busy
                ? "text-amber-400/80"
                : message.toolError
                  ? "text-red-400/70"
                  : "text-zinc-600"
            }`}
          >
            {status}
          </span>
          {duration && (
            <span className="shrink-0 text-[10px] text-zinc-600">{duration}</span>
          )}
        </div>
        {hasDetails && <ToolDetails message={message} compact />}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border text-xs ${
        busy
          ? "border-amber-400/20 bg-amber-400/5 text-amber-200/80"
          : message.toolError
            ? "border-red-400/20 bg-red-400/5 text-red-300/80"
            : "border-zinc-800 bg-zinc-950/50 text-zinc-500"
      }`}
    >
      <button
        type="button"
        onClick={() => setManualExpanded((v) => !(v ?? busy))}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-zinc-900/40"
      >
        <Chevron expanded={expanded} className="mt-0.5" />
        <span className="mt-0.5 shrink-0">{statusIcon(message)}</span>
        <span className="mt-0.5 shrink-0 text-zinc-600">{icon}</span>
        <span className="min-w-0 flex-1 break-all font-mono">{label}</span>
        <span
          className={`mt-0.5 shrink-0 text-[10px] uppercase tracking-wide ${
            busy
              ? "text-amber-400/80"
              : message.toolError
                ? "text-red-400/70"
                : "text-zinc-600"
          }`}
        >
          {status}
        </span>
        {duration && (
          <span className="mt-0.5 shrink-0 text-[10px] text-zinc-600">
            {duration}
          </span>
        )}
      </button>
      {expanded && hasDetails && (
        <div className="border-t border-zinc-800/80 px-3 py-2">
          <ToolDetails message={message} />
        </div>
      )}
    </div>
  );
}

function ToolDetails({
  message,
  compact = false,
}: {
  message: AgentDisplayMessage;
  compact?: boolean;
}) {
  const isShell = message.toolName?.toLowerCase() === "shell";
  const args = formatToolArgs(message.toolArgs);
  const duration = formatToolDuration(message.toolDurationMs);
  const sectionClass = compact
    ? "mt-1.5 space-y-1.5"
    : "space-y-2 text-[11px] leading-relaxed";

  if (isShell) {
    return (
      <div className={sectionClass}>
        <ShellToolOutput
          message={message}
          autoScroll={message.toolStatus === "started"}
        />
        {message.toolError && (
          <div>
            <p className="mb-0.5 text-[10px] uppercase tracking-wide text-red-400/70">
              Error
            </p>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-red-400/5 p-2 font-mono text-red-300/80">
              {message.toolError}
            </pre>
          </div>
        )}
        {duration && (
          <p className="text-[10px] text-zinc-600">Duration: {duration}</p>
        )}
      </div>
    );
  }

  return (
    <div className={sectionClass}>
      {message.toolName && !compact && (
        <DetailRow label="Tool" value={message.toolName} />
      )}
      {message.toolCallId && !compact && (
        <DetailRow label="Call ID" value={message.toolCallId} mono />
      )}
      {args && (
        <div>
          {!compact && (
            <p className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
              Args
            </p>
          )}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-zinc-500">
            {args}
          </pre>
        </div>
      )}
      {message.toolResultText && (
        <div>
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
            Result
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-zinc-500">
            {message.toolResultText}
          </pre>
        </div>
      )}
      {message.toolError && (
        <div>
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-red-400/70">
            Error
          </p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-red-400/5 p-2 font-mono text-red-300/80">
            {message.toolError}
          </pre>
        </div>
      )}
      {duration && compact && (
        <p className="text-[10px] text-zinc-600">Duration: {duration}</p>
      )}
      {duration && !compact && <DetailRow label="Duration" value={duration} />}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">
        {label}
      </span>
      <span
        className={`min-w-0 break-all text-zinc-500 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
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
  const isThinking = message.id.startsWith("thinking-");

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] ${
          isUser
            ? "bg-orange-500/20 text-orange-100"
            : isThinking
              ? "border border-zinc-700/80 bg-zinc-900/80 text-zinc-400"
              : "bg-zinc-800 text-zinc-200"
        }`}
      >
        {isThinking && (
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Thinking
          </p>
        )}
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

function statusIcon(message: AgentDisplayMessage): string {
  if (message.toolError) return "✕";
  switch (message.toolStatus) {
    case "completed":
      return "✓";
    case "started":
      return "…";
    default:
      return "·";
  }
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
  if (message.content) return message.content;
  const name = message.toolName ?? "tool";
  const path =
    typeof message.toolArgs?.path === "string" ? message.toolArgs.path : "";
  return path ? `${name}: ${path}` : name;
}
