"use client";

import { useEffect, useMemo, useState } from "react";
import { stringify } from "yaml";
import { Button, Input } from "@/components/ui";
import {
  EDITABLE_SERVICE_KEYS,
  parseComposeYaml,
  stringifyCompose,
  viewOnlyServiceKeys,
} from "@/lib/compose-document";

type EditorMode = "form" | "yaml";

type ComposeState = {
  fileName: string | null;
  yaml: string;
  envText: string;
  warnings: string[];
  watchBranch: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function portsToText(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  return value
    .map((item) => (typeof item === "string" ? item : stringify(item).trim()))
    .join("\n");
}

function textToPorts(text: string): unknown {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines;
}

function envToText(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return stringify(item).trim();
        return String(item);
      })
      .join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => `${key}=${val ?? ""}`)
      .join("\n");
  }
  return String(value);
}

function textToEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

export function ComposeStudio({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ComposeState | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [envText, setEnvText] = useState("");
  const [mode, setMode] = useState<EditorMode>("form");
  const [error, setError] = useState("");
  const [parseError, setParseError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedBranch, setSavedBranch] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/compose`)
      .then(async (res) => {
        const data = (await res.json()) as ComposeState & { error?: string };
        return { ok: res.ok, data };
      })
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(data.error ?? "Failed to load compose");
          setLoading(false);
          return;
        }
        setState(data);
        setYamlText(data.yaml);
        setEnvText(data.envText);
        setParseError("");
        setError("");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load compose");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const parsed = useMemo(() => parseComposeYaml(yamlText), [yamlText]);

  function switchMode(next: EditorMode) {
    if (next === "form") {
      const result = parseComposeYaml(yamlText);
      if (!result.ok) {
        setParseError(result.error);
        return;
      }
      setParseError("");
    }
    setMode(next);
  }

  function updateService(name: string, key: string, value: unknown) {
    const result = parseComposeYaml(yamlText);
    if (!result.ok) return;
    const services = asRecord(result.doc.services);
    const service = { ...asRecord(services[name]), [key]: value };
    const nextDoc = {
      ...result.doc,
      services: { ...services, [name]: service },
    };
    setYamlText(stringifyCompose(nextDoc));
  }

  async function reload() {
    const res = await fetch(`/api/projects/${projectId}/compose`);
    const data = (await res.json()) as ComposeState & { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to load compose");
      return;
    }
    setState(data);
    setYamlText(data.yaml);
    setEnvText(data.envText);
    setParseError("");
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/compose`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlText, envText }),
      });
      const data = (await res.json()) as {
        error?: string;
        branch?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setSavedBranch(data.branch ?? null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function createStarter() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/compose/create`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string; branch?: string };
      if (!res.ok) {
        setError(data.error ?? "Create failed");
        return;
      }
      setSavedBranch(data.branch ?? null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function mergeDeploy() {
    if (!savedBranch) return;
    setMerging(true);
    setError("");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/compose/merge-deploy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch: savedBranch }),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Merge & deploy failed");
        return;
      }
      setSavedBranch(null);
    } finally {
      setMerging(false);
    }
  }

  if (loading && !state) {
    return (
      <p className="text-sm text-[var(--forge-muted)]">Loading compose…</p>
    );
  }

  if (state && !state.fileName && !yamlText) {
    return (
      <div className="forge-surface-elevated space-y-4 p-6">
        {error ? (
          <p className="text-sm text-[var(--forge-danger)]">{error}</p>
        ) : null}
        <p className="text-sm text-[var(--forge-muted)]">
          This project has no compose file yet.
        </p>
        <Button type="button" onClick={() => void createStarter()} disabled={saving}>
          {saving ? "Creating…" : "Create docker-compose.yml"}
        </Button>
      </div>
    );
  }

  const warnings = parsed.ok ? parsed.warnings : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={mode === "form" ? "primary" : "secondary"}
          onClick={() => switchMode("form")}
        >
          Form
        </Button>
        <Button
          type="button"
          variant={mode === "yaml" ? "primary" : "secondary"}
          onClick={() => switchMode("yaml")}
        >
          YAML
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save to branch"}
        </Button>
        {savedBranch ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void mergeDeploy()}
            disabled={merging}
          >
            {merging ? "Merging…" : `Merge & deploy ${savedBranch}`}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-[var(--forge-danger)]">{error}</p>
      ) : null}
      {parseError ? (
        <p className="text-sm text-[var(--forge-danger)]">{parseError}</p>
      ) : null}
      {warnings.map((warning) => (
        <p key={warning} className="text-sm text-amber-300/90">
          {warning}
        </p>
      ))}
      <p className="font-mono text-xs text-[var(--forge-faint)]">
        {state?.fileName ?? "docker-compose.yml"} · watch {state?.watchBranch}
      </p>

      {mode === "yaml" || !parsed.ok ? (
        <textarea
          className="min-h-[20rem] flex-1 rounded-[10px] border border-[var(--forge-line)] bg-[var(--forge-bg)] p-3 font-mono text-sm text-[var(--forge-bright)]"
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {Object.entries(parsed.services).map(([name, service]) => {
            const hidden = viewOnlyServiceKeys(service);
            return (
              <section key={name} className="forge-surface-elevated space-y-3 p-4">
                <h2 className="text-sm font-semibold text-[var(--forge-bright)]">
                  {name}
                  {name === "app" ? (
                    <span className="ml-2 text-xs font-normal text-[var(--forge-muted)]">
                      required for Forge rollback
                    </span>
                  ) : null}
                </h2>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--forge-muted)]">Image</span>
                  <Input
                    value={typeof service.image === "string" ? service.image : ""}
                    onChange={(e) => updateService(name, "image", e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--forge-muted)]">Restart</span>
                  <Input
                    value={typeof service.restart === "string" ? service.restart : ""}
                    onChange={(e) => updateService(name, "restart", e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--forge-muted)]">
                    Command
                  </span>
                  <Input
                    value={
                      typeof service.command === "string"
                        ? service.command
                        : service.command
                          ? stringify(service.command).trim()
                          : ""
                    }
                    onChange={(e) => updateService(name, "command", e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--forge-muted)]">
                    Ports (one per line)
                  </span>
                  <textarea
                    className="w-full rounded-[10px] border border-[var(--forge-line)] bg-[var(--forge-bg)] p-2 font-mono text-sm"
                    rows={3}
                    value={portsToText(service.ports)}
                    onChange={(e) =>
                      updateService(name, "ports", textToPorts(e.target.value))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--forge-muted)]">
                    Environment (KEY=value)
                  </span>
                  <textarea
                    className="w-full rounded-[10px] border border-[var(--forge-line)] bg-[var(--forge-bg)] p-2 font-mono text-sm"
                    rows={4}
                    value={envToText(service.environment)}
                    onChange={(e) =>
                      updateService(name, "environment", textToEnv(e.target.value))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--forge-muted)]">
                    Volumes (one per line)
                  </span>
                  <textarea
                    className="w-full rounded-[10px] border border-[var(--forge-line)] bg-[var(--forge-bg)] p-2 font-mono text-sm"
                    rows={3}
                    value={portsToText(service.volumes)}
                    onChange={(e) =>
                      updateService(name, "volumes", textToPorts(e.target.value))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[var(--forge-muted)]">
                    Depends on (comma-separated)
                  </span>
                  <Input
                    value={
                      Array.isArray(service.depends_on)
                        ? service.depends_on.filter((v) => typeof v === "string").join(", ")
                        : typeof service.depends_on === "string"
                          ? service.depends_on
                          : service.depends_on
                            ? stringify(service.depends_on).trim()
                            : ""
                    }
                    onChange={(e) =>
                      updateService(
                        name,
                        "depends_on",
                        e.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                </label>
                {hidden.length > 0 ? (
                  <details className="rounded-[8px] border border-[var(--forge-line)] p-2">
                    <summary className="cursor-pointer text-xs text-[var(--forge-muted)]">
                      View-only keys (edit in YAML): {hidden.join(", ")}
                    </summary>
                    <pre className="mt-2 overflow-x-auto text-xs text-[var(--forge-faint)]">
                      {hidden
                        .map(
                          (key) =>
                            `${key}: ${stringify(service[key] ?? null).trim()}`,
                        )
                        .join("\n")}
                    </pre>
                  </details>
                ) : null}
                {EDITABLE_SERVICE_KEYS.filter(
                  (key) =>
                    ![
                      "image",
                      "restart",
                      "command",
                      "ports",
                      "environment",
                      "volumes",
                      "depends_on",
                    ].includes(key) && service[key] !== undefined,
                ).length > 0 ? (
                  <details className="rounded-[8px] border border-[var(--forge-line)] p-2">
                    <summary className="cursor-pointer text-xs text-[var(--forge-muted)]">
                      Other editable keys
                    </summary>
                    <pre className="mt-2 overflow-x-auto text-xs text-[var(--forge-faint)]">
                      {EDITABLE_SERVICE_KEYS.filter(
                        (key) =>
                          ![
                            "image",
                            "restart",
                            "command",
                            "ports",
                            "environment",
                            "volumes",
                            "depends_on",
                          ].includes(key) && service[key] !== undefined,
                      )
                        .map(
                          (key) =>
                            `${key}: ${stringify(service[key] ?? null).trim()}`,
                        )
                        .join("\n")}
                    </pre>
                    <p className="mt-1 text-[10px] text-[var(--forge-faint)]">
                      Switch to YAML to edit build, healthcheck, networks,
                      extra_hosts, entrypoint, env_file.
                    </p>
                  </details>
                ) : null}
                <p className="text-[10px] text-[var(--forge-faint)]">
                  Editable: {EDITABLE_SERVICE_KEYS.join(", ")}
                </p>
              </section>
            );
          })}
        </div>
      )}

      <label className="block shrink-0 text-sm">
        <span className="mb-1 block text-[var(--forge-muted)]">.env (repo)</span>
        <textarea
          className="h-28 w-full rounded-[10px] border border-[var(--forge-line)] bg-[var(--forge-bg)] p-2 font-mono text-sm"
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          spellCheck={false}
        />
      </label>
    </div>
  );
}
