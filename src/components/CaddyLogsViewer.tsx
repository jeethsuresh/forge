"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BufferedCaddyLogEntry } from "@/lib/caddy-log-buffer";
import type { CaddyLogEntry } from "@/lib/caddy-logs";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

type LogEntry = CaddyLogEntry & { seq?: number };

interface LogsResponse {
  configured: boolean;
  source: "push";
  ingestPath?: string;
  tailSeq?: number;
  entries: LogEntry[];
  error?: string;
}

function statusTone(status: number | null | undefined): string {
  if (status === null || status === undefined) return "text-zinc-400";
  if (status >= 500) return "text-red-400";
  if (status >= 400) return "text-amber-400";
  if (status >= 300) return "text-sky-400";
  return "text-emerald-400";
}

function entryKey(entry: LogEntry, index: number): string {
  if (entry.seq !== undefined) {
    return `seq:${entry.seq}`;
  }
  return `${entry.raw.slice(0, 80)}:${index}`;
}

export function CaddyLogsViewer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const cursorRef = useRef(0);
  const pausedRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const streamGenerationRef = useRef(0);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const appendEntries = useCallback((incoming: LogEntry[]) => {
    if (incoming.length === 0 || pausedRef.current) return;
    setEntries((prev) => {
      const next = [...prev, ...incoming];
      if (next.length > 2000) {
        return next.slice(-2000);
      }
      return next;
    });
  }, []);

  const connectStream = useCallback(() => {
    const generation = ++streamGenerationRef.current;
    eventSourceRef.current?.close();

    const query = `afterSeq=${cursorRef.current}`;
    const es = new EventSource(`/api/caddy/logs/stream?${query}`);
    eventSourceRef.current = es;

    es.onopen = () => {
      if (streamGenerationRef.current !== generation) return;
      setConnected(true);
      setError(null);
    };

    es.onerror = () => {
      if (streamGenerationRef.current !== generation) return;
      setConnected(false);
    };

    es.addEventListener("entries", (event) => {
      if (streamGenerationRef.current !== generation) return;
      const payload = JSON.parse(event.data) as {
        entries: BufferedCaddyLogEntry[];
        tailSeq?: number;
      };

      if (typeof payload.tailSeq === "number") {
        cursorRef.current = payload.tailSeq;
      }

      appendEntries(payload.entries);
    });

    es.addEventListener("heartbeat", (event) => {
      if (streamGenerationRef.current !== generation) return;
      const payload = JSON.parse(event.data) as {
        tailSeq?: number;
      };

      if (typeof payload.tailSeq === "number") {
        cursorRef.current = payload.tailSeq;
      }
    });
  }, [appendEntries]);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/caddy/logs?tail=300");
      const json = (await res.json()) as LogsResponse;
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load Caddy logs");
      }

      cursorRef.current = json.tailSeq ?? 0;
      setEntries(json.entries);

      connectStream();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Caddy logs");
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [connectStream]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadSnapshot();
    });
    return () => {
      streamGenerationRef.current += 1;
      eventSourceRef.current?.close();
    };
  }, [loadSnapshot]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldAutoScrollRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 48;
  };

  const filteredEntries = filter.trim()
    ? entries.filter((entry) => {
        const needle = filter.trim().toLowerCase();
        return (
          entry.formatted.toLowerCase().includes(needle) ||
          entry.raw.toLowerCase().includes(needle)
        );
      })
    : entries;

  if (loading) {
    return (
      <p className="text-sm text-zinc-500">Loading Caddy logs…</p>
    );
  }

  return (
    <div className="flex min-h-[28rem] flex-col rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-zinc-200">Live access logs</h2>
          <p className="truncate font-mono text-xs text-zinc-500">
            Push to {APP_DISPLAY_NAME} (in-memory)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
              connected
                ? "bg-emerald-400/10 text-emerald-400"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            {connected ? "Live" : "Disconnected"}
          </span>
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            className="min-h-9 rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEntries([]);
              shouldAutoScrollRef.current = true;
            }}
            className="min-h-9 rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            className="min-h-9 rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Reload
          </button>
        </div>
      </div>

      <p className="border-b border-zinc-800 px-4 py-3 text-xs text-zinc-500">
        In-memory buffer only — logs are not persisted. Enable Push to {APP_DISPLAY_NAME} on
        the Routes tab or POST JSON to{" "}
        <code className="text-zinc-400">/api/caddy/logs/ingest</code>.
      </p>

      <div className="border-b border-zinc-800 px-4 py-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter logs…"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
      </div>

      {error && (
        <p className="border-b border-zinc-800 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {filteredEntries.length === 0 ? (
          <p className="px-2 py-4 text-sm text-zinc-500">
            {paused
              ? "Paused. New log lines will queue until you resume."
              : `No logs yet. Enable Push to ${APP_DISPLAY_NAME} on the Routes tab or POST access log JSON to the ingest API.`}
          </p>
        ) : (
          <ul className="space-y-1">
            {filteredEntries.map((entry, index) => (
              <li
                key={entryKey(entry, index)}
                className="rounded-md px-2 py-1.5 font-mono text-xs leading-relaxed hover:bg-zinc-950/80"
              >
                {entry.parsed ? (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {entry.parsed.timestamp && (
                      <span className="text-zinc-600">
                        {entry.parsed.timestamp
                          .replace("T", " ")
                          .replace(/\.\d{3}Z$/, "Z")}
                      </span>
                    )}
                    {entry.parsed.method && (
                      <span className="text-zinc-300">
                        {entry.parsed.method}
                      </span>
                    )}
                    {(entry.parsed.host || entry.parsed.uri) && (
                      <span className="text-zinc-200">
                        {entry.parsed.host}
                        {entry.parsed.uri}
                      </span>
                    )}
                    {entry.parsed.status !== null && (
                      <span className={statusTone(entry.parsed.status)}>
                        {entry.parsed.status}
                      </span>
                    )}
                    {entry.parsed.durationMs !== null && (
                      <span className="text-zinc-500">
                        {entry.parsed.durationMs < 10
                          ? `${entry.parsed.durationMs.toFixed(1)}ms`
                          : `${Math.round(entry.parsed.durationMs)}ms`}
                      </span>
                    )}
                    {entry.parsed.size !== null && (
                      <span className="text-zinc-500">
                        {entry.parsed.size}B
                      </span>
                    )}
                    {entry.parsed.remoteAddr && (
                      <span className="text-zinc-600">
                        {entry.parsed.remoteAddr}
                      </span>
                    )}
                    {!entry.parsed.method && entry.parsed.message && (
                      <span className="text-zinc-400">
                        {entry.parsed.message}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap text-zinc-400">
                    {entry.formatted}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
