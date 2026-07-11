"use client";

import { useEffect, useRef } from "react";
import { formatDuration, shortSha, statusColor } from "@/lib/utils";
import type { ActiveDeployLogView } from "@/lib/active-deploy-logs";

export function ActiveDeployLogsPanel({
  view,
  className = "",
}: {
  view: ActiveDeployLogView;
  className?: string;
}) {
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const element = logRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [view.logs]);

  return (
    <section
      className={`mb-8 rounded-xl border border-amber-400/20 bg-amber-400/5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-zinc-100">{view.title}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Running for {formatDuration(view.startedAt)}
            {view.branch ? (
              <>
                {" "}
                · branch{" "}
                <span className="font-mono text-zinc-400">{view.branch}</span>
              </>
            ) : null}
            {view.commitSha ? (
              <>
                {" "}
                ·{" "}
                <span className="font-mono text-zinc-400">
                  {shortSha(view.commitSha)}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusColor(view.status)}`}
        >
          {view.statusLabel}
        </span>
      </div>

      {view.errorMessage && (
        <div className="border-b border-amber-400/10 px-4 py-3 text-sm text-red-300">
          {view.errorMessage}
        </div>
      )}

      <pre
        ref={logRef}
        className="max-h-96 overflow-auto whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-relaxed text-zinc-300"
      >
        {view.logs || "Waiting for deploy output…"}
      </pre>
    </section>
  );
}
