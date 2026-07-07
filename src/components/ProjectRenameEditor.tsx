"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { composeProjectName } from "@/lib/compose-project-name";

interface ProjectRenameEditorProps {
  projectId: string;
  name: string;
  disabled?: boolean;
  onRenamed: () => Promise<void>;
}

export function ProjectRenameEditor({
  projectId,
  name,
  disabled = false,
  onRenamed,
}: ProjectRenameEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const suggestedComposeName = composeProjectName(draftName);
  const composeNameChanged =
    editing && suggestedComposeName !== composeProjectName(name);

  async function save() {
    const trimmed = draftName.trim();
    if (trimmed === name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to rename project");
        return;
      }
      setEditing(false);
      await onRenamed();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraftName(name);
    setError("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <h1 className="text-xl font-semibold text-zinc-100 sm:text-2xl">
          {name}
        </h1>
        <button
          type="button"
          onClick={() => {
            setDraftName(name);
            setError("");
            setEditing(true);
          }}
          disabled={disabled}
          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
        >
          Rename
        </button>
        <p className="w-full font-mono text-xs text-zinc-600">
          Compose project: {composeProjectName(name)}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl space-y-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
          Project name
        </span>
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          disabled={saving}
          autoFocus
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
        />
      </label>
      <p className="font-mono text-xs text-zinc-500">
        Compose project name:{" "}
        <span className="text-orange-400">{suggestedComposeName}</span>
      </p>
      {composeNameChanged && (
        <p className="text-xs text-amber-400/90">
          Renaming changes the compose project name. Redeploy to move running
          containers to the new name.
        </p>
      )}
      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !draftName.trim()}
          className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
