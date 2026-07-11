"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CaddyLogEntry } from "@/lib/caddy-logs";

export function entryMatchesLogHosts(
  entry: CaddyLogEntry,
  hosts: string[],
): boolean {
  if (hosts.length === 0) return true;
  const entryHost = entry.parsed?.host?.toLowerCase();
  if (!entryHost) return false;
  return hosts.some(
    (host) => entryHost === host || entryHost.endsWith(`.${host}`),
  );
}

function statusTone(status: number | null | undefined): string {
  if (status === null || status === undefined) return "text-zinc-400";
  if (status >= 500) return "text-red-400";
  if (status >= 400) return "text-amber-400";
  if (status >= 300) return "text-sky-400";
  return "text-emerald-400";
}

interface ProjectCaddyLogsPanelProps {
  hosts: string[];
  className?: string;
}

export function ProjectCaddyLogsPanel({
  hosts,
  className = "",
}: ProjectCaddyLogsPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CaddyLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const cursorRef = useRef(0);
  const streamGenerationRef = useRef(0);

  const filteredEntries = entries.filter((entry) =>
    entryMatchesLogHosts(entry, hosts),
  );

  const connectStream = useCallback(() => {
    const generation = ++streamGenerationRef.current;
    eventSourceRef.current?.close();

    const es = new EventSource(
      `/api/caddy/logs/stream?afterSeq=${cursorRef.current}`,
    );
    eventSourceRef.current = es;

    es.onopen = () => {
      if (streamGenerationRef.current !== generation) return;
      setConnected(true);
      setError(null);
    };

    es.onerror = () => {
      if (streamGenerationRef.current !== generation) return;
      setConnected(false);
      es.close();
      eventSourceRef.current = null;
    };

    es.addEventListener("entries", (event) => {
      if (streamGenerationRef.current !== generation) return;
      const payload = JSON.parse(event.data) as {
        entries: Array<CaddyLogEntry & { seq?: number }>;
        tailSeq?: number;
      };
      if (typeof payload.tailSeq === "number") {
        cursorRef.current = payload.tailSeq;
      }
      const incoming = payload.entries.filter((entry) =>
        entryMatchesLogHosts(entry, hosts),
      );
      if (incoming.length === 0) return;
      setEntries((prev) => {
        const next = [...prev, ...incoming];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
  }, [hosts]);

  const streamLive = open && connected;

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/caddy/logs?tail=200");
      const json = (await res.json()) as {
        entries?: CaddyLogEntry[];
        tailSeq?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load Caddy logs");
      }
      cursorRef.current = json.tailSeq ?? 0;
      setEntries(
        (json.entries ?? []).filter((entry) =>
          entryMatchesLogHosts(entry, hosts),
        ),
      );
      connectStream();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [connectStream, hosts]);

  useEffect(() => {
    if (!open) {
      streamGenerationRef.current += 1;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    queueMicrotask(() => {
      void loadSnapshot();
    });
    return () => {
      streamGenerationRef.current += 1;
      eventSourceRef.current?.close();
    };
  }, [open, loadSnapshot]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredEntries, open]);

  if (hosts.length === 0) {
    return (
      <div
        className={`rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-500 ${className}`}
      >
        Link Caddy routes with host matchers to see filtered access logs here.
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950/50 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-medium text-zinc-200">Caddy access logs</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Filtered to{" "}
            <span className="font-mono text-zinc-400">{hosts.join(", ")}</span>
          </p>
        </div>
        <span className="shrink-0 text-xs text-zinc-500">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                streamLive
                  ? "bg-emerald-400/10 text-emerald-400"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  streamLive ? "bg-emerald-400" : "bg-zinc-600"
                }`}
              />
              {streamLive ? "Live" : "Disconnected"}
            </span>
            <span className="text-zinc-600">
              {filteredEntries.length} matching entries
            </span>
          </div>

          {error && (
            <p className="mb-2 text-xs text-red-400">{error}</p>
          )}

          {loading ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              Loading logs…
            </p>
          ) : filteredEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              No matching access log entries yet.
            </p>
          ) : (
            <div
              ref={scrollRef}
              className="max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs"
            >
              {filteredEntries.map((entry, index) => (
                <div
                  key={`${entry.raw.slice(0, 40)}:${index}`}
                  className="border-b border-zinc-800/60 px-3 py-2 last:border-b-0"
                >
                  <span
                    className={`${statusTone(entry.parsed?.status ?? null)}`}
                  >
                    {entry.formatted}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
