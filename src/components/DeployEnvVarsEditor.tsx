"use client";

import { useState } from "react";

export interface DeployEnvVarRow {
  key: string;
  value: string;
  secret: boolean;
  hasValue: boolean;
}

interface DeployEnvVarsEditorProps {
  vars: DeployEnvVarRow[];
  envFileSource?: ".env" | ".env.example" | null;
  disabled?: boolean;
  saving?: boolean;
  onSave: (vars: DeployEnvVarRow[]) => Promise<boolean>;
}

const SECRET_KEY_PATTERN =
  /(PASSWORD|SECRET|TOKEN|PRIVATE|API_KEY|CREDENTIAL|AUTH)/i;

function inferSecretFromKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function emptyRow(): DeployEnvVarRow {
  return { key: "", value: "", secret: false, hasValue: false };
}

function rowsFromServer(vars: DeployEnvVarRow[]): DeployEnvVarRow[] {
  if (vars.length === 0) return [emptyRow()];
  return vars.map((item) => ({ ...item }));
}

export function DeployEnvVarsEditor({
  vars,
  envFileSource = null,
  disabled = false,
  saving = false,
  onSave,
}: DeployEnvVarsEditorProps) {
  const [expanded, setExpanded] = useState(() => vars.length > 0);
  const [rows, setRows] = useState<DeployEnvVarRow[]>(() => rowsFromServer(vars));
  const [dirty, setDirty] = useState(false);

  const configuredCount = vars.filter((item) => item.hasValue).length;

  function updateRow(index: number, patch: Partial<DeployEnvVarRow>) {
    setDirty(true);
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setDirty(true);
    setExpanded(true);
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setDirty(true);
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [emptyRow()] : next;
    });
  }

  function clearSecretValue(index: number) {
    setDirty(true);
    setRows((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, value: "", hasValue: false } : row,
      ),
    );
  }

  function handleKeyChange(index: number, key: string) {
    const upper = key.toUpperCase();
    updateRow(index, {
      key: upper,
      secret: inferSecretFromKey(upper),
    });
  }

  function handleSecretToggle(index: number, checked: boolean) {
    const row = rows[index];
    if (!checked && row.secret && row.hasValue && !row.value.trim()) {
      return;
    }
    updateRow(index, { secret: checked });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload = rows
      .filter((row) => row.key.trim())
      .map((row) => ({
        ...row,
        hasValue: row.value.trim().length > 0 ? true : row.hasValue,
      }));
    const ok = await onSave(payload);
    if (ok) {
      setDirty(false);
    }
  }

  const sourceHint = envFileSource
    ? `Prefilled from ${envFileSource}`
    : "Passed to build, test, deploy, and teardown scripts for this project.";

  return (
    <section className="mb-8 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/50"
      >
        <span
          className={`shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        >
          ›
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Environment variables
          </h2>
          <p className="mt-0.5 text-xs text-zinc-600">
            {expanded ? sourceHint : `${sourceHint}${vars.length > 0 ? ` · ${vars.length} variable${vars.length === 1 ? "" : "s"}` : ""}`}
          </p>
        </div>
        {configuredCount > 0 && !expanded && (
          <span className="shrink-0 rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-400">
            {configuredCount} configured
          </span>
        )}
      </button>

      {expanded && (
        <form onSubmit={handleSave} className="border-t border-zinc-800">
          <div className="flex justify-end px-4 pt-3">
            <button
              type="button"
              onClick={addRow}
              disabled={disabled || saving}
              className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Add variable
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-zinc-600">
              No environment variables configured.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {rows.map((row, index) => {
                const maskedSaved =
                  row.secret && row.hasValue && !row.value.trim();
                return (
                  <li
                    key={index}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start"
                  >
                    <label className="min-w-0 flex-1">
                      <span className="mb-1 block text-xs text-zinc-500">Name</span>
                      <input
                        type="text"
                        value={row.key}
                        onChange={(e) => handleKeyChange(index, e.target.value)}
                        placeholder="DATABASE_URL"
                        disabled={disabled || saving}
                        className="min-h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none disabled:opacity-50"
                      />
                    </label>
                    <label className="min-w-0 flex-[2]">
                      <span className="mb-1 block text-xs text-zinc-500">Value</span>
                      <div className="flex gap-2">
                        <input
                          type={row.secret ? "password" : "text"}
                          value={row.value}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateRow(index, {
                              value,
                              hasValue: value.length > 0,
                            });
                          }}
                          placeholder={
                            maskedSaved
                              ? "Saved secret (leave blank to keep)"
                              : "Value"
                          }
                          disabled={disabled || saving}
                          className="min-h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-orange-500 focus:outline-none disabled:opacity-50"
                        />
                        {maskedSaved && (
                          <button
                            type="button"
                            onClick={() => clearSecretValue(index)}
                            disabled={disabled || saving}
                            className="shrink-0 min-h-10 rounded-lg border border-zinc-700 px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-50"
                            title="Clear saved secret"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </label>
                    <label
                      className="flex min-h-10 items-center gap-2 pt-6 sm:items-end sm:pb-2 sm:pt-0"
                      title={
                        maskedSaved
                          ? "Enter a new value or clear before unmarking as secret"
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={row.secret}
                        onChange={(e) =>
                          handleSecretToggle(index, e.target.checked)
                        }
                        disabled={disabled || saving || maskedSaved}
                        className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 text-orange-500 focus:ring-orange-500 disabled:opacity-50"
                      />
                      <span className="text-xs text-zinc-400">Secret</span>
                    </label>
                    <div className="flex items-end pb-0.5 sm:pb-2">
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        disabled={disabled || saving}
                        className="min-h-9 rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400 disabled:opacity-50"
                        aria-label="Remove variable"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
            {dirty && (
              <span className="mr-auto text-xs text-amber-400/90">
                Unsaved changes
              </span>
            )}
            <button
              type="submit"
              disabled={disabled || saving || !dirty}
              className="min-h-9 rounded-lg bg-zinc-700 px-4 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save variables"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
