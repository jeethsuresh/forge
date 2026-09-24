"use client";

import { useEffect, useState } from "react";

export function SessionLearningsDisclosure({
  text,
  forceOpen,
  disabled,
  onSave,
}: {
  text: string;
  forceOpen: boolean;
  disabled?: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(forceOpen);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setDraft(text);
    });
  }, [text]);

  useEffect(() => {
    if (!forceOpen) return;
    queueMicrotask(() => {
      setOpen(true);
    });
  }, [forceOpen]);

  const expanded = forceOpen || open;

  async function persist() {
    if (disabled || saving) return;
    const next = draft;
    if (next.trim() === text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-[var(--forge-line)] bg-[rgba(255,255,255,0.02)] px-4 py-2">
      <button
        type="button"
        disabled={forceOpen}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-8 w-full items-center gap-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--forge-faint)] hover:text-[var(--forge-muted)] disabled:cursor-default disabled:hover:text-[var(--forge-faint)]"
      >
        <span className="font-mono text-[10px] text-[var(--forge-faint)]" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
        Learnings
        {saving && (
          <span className="normal-case tracking-normal text-[var(--forge-faint)]">
            Saving…
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void persist()}
            disabled={disabled || saving}
            rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))}
            className="w-full resize-y rounded-lg border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.35)] px-3 py-2 font-sans text-xs leading-relaxed text-[var(--forge-bright)] placeholder:text-[var(--forge-faint)] focus:border-orange-500 focus:outline-none disabled:opacity-60"
            placeholder="No compacted learnings yet. They appear after the agent finishes a non-question turn."
          />
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
