"use client";

import { useEffect, useRef } from "react";
import type { AgentDisplayMessage } from "@/lib/agent-stream";

export function ShellToolOutput({
  message,
  autoScroll = false,
}: {
  message: AgentDisplayMessage;
  autoScroll?: boolean;
}) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const running = message.toolStatus === "started";
  const stdout = message.toolStdout ?? "";
  const stderr = message.toolStderr ?? "";
  const hasOutput = Boolean(stdout || stderr);

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [stdout, stderr, autoScroll]);

  const command =
    typeof message.toolArgs?.command === "string"
      ? message.toolArgs.command
      : null;

  return (
    <div className="space-y-2">
      {command && (
        <div>
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
            Command
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-900/60 p-2 font-mono text-[11px] text-zinc-400">
            {command}
          </pre>
        </div>
      )}
      <div>
        <p className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
          Output
        </p>
        <pre
          ref={scrollRef}
          className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-800 bg-black/40 p-2 font-mono text-[11px] leading-relaxed"
        >
          {!hasOutput && running && (
            <span className="text-zinc-600">Waiting for shell output…</span>
          )}
          {!hasOutput && !running && (
            <span className="text-zinc-600">No output</span>
          )}
          {stdout && (
            <span className="text-zinc-300">{stdout}</span>
          )}
          {stderr && (
            <span className={stdout ? "text-red-300/90" : "text-red-300/90"}>
              {stdout ? "\n" : ""}
              {stderr}
            </span>
          )}
        </pre>
      </div>
    </div>
  );
}
