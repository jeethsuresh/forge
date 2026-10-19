"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import type { AgentBackendId } from "@/lib/agent-backends/types";

type BackendInfo = {
  id: AgentBackendId;
  displayName: string;
  available: boolean;
  reason: string | null;
};

type BackendSettings = {
  backend: AgentBackendId;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
};

export function AgentBackendsSettings() {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [settings, setSettings] = useState<BackendSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<AgentBackendId | null>(null);
  const [models, setModels] = useState<Record<AgentBackendId, string>>({
    cursor: "",
    codex: "",
    local: "",
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeys, setApiKeys] = useState<Record<"codex" | "local", string>>({
    codex: "",
    local: "",
  });

  const load = useCallback(() => {
    fetch("/api/settings/agent-backends")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load (${res.status})`);
        }
        return res.json() as Promise<{
          backends: BackendInfo[];
          settings: BackendSettings[];
        }>;
      })
      .then((payload) => {
        setBackends(payload.backends);
        setSettings(payload.settings);
        const nextModels = { cursor: "", codex: "", local: "" };
        for (const row of payload.settings) {
          nextModels[row.backend] = row.model;
          if (row.backend === "local") setBaseUrl(row.baseUrl);
        }
        setModels(nextModels);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(backend: AgentBackendId) {
    setSaving(backend);
    setError(null);
    try {
      const res = await fetch("/api/settings/agent-backends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend,
          model: models[backend],
          baseUrl: backend === "local" ? baseUrl : undefined,
          apiKey:
            backend === "codex" || backend === "local"
              ? apiKeys[backend] || undefined
              : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed to save (${res.status})`);
      if (backend === "codex" || backend === "local") {
        setApiKeys((prev) => ({ ...prev, [backend]: "" }));
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading backends…</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted)]">
        Sessions pick Cursor, Codex, or a local OpenAI-compatible model. Thinking is
        always extra-high / xhigh, then high.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {backends.map((backend) => {
        const row = settings.find((s) => s.backend === backend.id);
        return (
          <section
            key={backend.id}
            className="rounded-xl border border-[var(--forge-line)] bg-[rgba(255,255,255,0.03)] p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[var(--forge-bright)]">
                {backend.displayName}
              </h3>
              <span
                className={`text-xs ${backend.available ? "text-emerald-300" : "text-amber-300"}`}
              >
                {backend.available ? "Available" : "Not ready"}
              </span>
            </div>
            {!backend.available && backend.reason && (
              <p className="mb-3 text-xs text-[var(--forge-muted)]">{backend.reason}</p>
            )}
            <label className="mb-3 block text-xs text-[var(--forge-muted)]">
              Model
              <Input
                className="mt-1"
                value={models[backend.id]}
                placeholder={
                  backend.id === "cursor" ? "gpt-5.5" : backend.id === "codex" ? "optional" : "llama3.2"
                }
                onChange={(e) =>
                  setModels((prev) => ({ ...prev, [backend.id]: e.target.value }))
                }
              />
            </label>
            {backend.id === "cursor" && (
              <p className="mb-3 text-xs text-[var(--forge-faint)]">
                Forge pins extra-high, then high. Auto is never sent.
              </p>
            )}
            {backend.id === "codex" && (
              <p className="mb-3 text-xs text-[var(--forge-faint)]">
                Runs <code>codex exec</code> with reasoning effort xhigh, then high.
              </p>
            )}
            {backend.id === "local" && (
              <p className="mb-3 text-xs text-[var(--forge-faint)]">
                Sends reasoning.effort xhigh, then high. If the API has no reasoning
                field, the session records thinking=none.
              </p>
            )}
            {backend.id === "local" && (
              <label className="mb-3 block text-xs text-[var(--forge-muted)]">
                Base URL
                <Input
                  className="mt-1"
                  value={baseUrl}
                  placeholder="http://127.0.0.1:11434/v1"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </label>
            )}
            {(backend.id === "codex" || backend.id === "local") && (
              <label className="mb-3 block text-xs text-[var(--forge-muted)]">
                API key {row?.hasApiKey ? "(saved)" : ""}
                <Input
                  className="mt-1"
                  type="password"
                  value={apiKeys[backend.id]}
                  placeholder={row?.hasApiKey ? "Leave blank to keep" : "Optional"}
                  onChange={(e) =>
                    setApiKeys((prev) => ({ ...prev, [backend.id]: e.target.value }))
                  }
                />
              </label>
            )}
            <Button
              type="button"
              size="sm"
              disabled={saving === backend.id}
              onClick={() => void save(backend.id)}
            >
              {saving === backend.id ? "Saving…" : "Save"}
            </Button>
          </section>
        );
      })}
    </div>
  );
}
