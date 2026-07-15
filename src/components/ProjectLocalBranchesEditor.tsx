"use client";

import { useCallback, useEffect, useState } from "react";

const NOT_FULLY_MERGED_CODE = "NOT_FULLY_MERGED";

interface LocalBranchesResponse {
  branches: string[];
  currentBranch: string | null;
  watchBranch: string;
}

interface ProjectLocalBranchesEditorProps {
  projectId: string;
  disabled?: boolean;
  onChanged?: () => Promise<void> | void;
}

export function ProjectLocalBranchesEditor({
  projectId,
  disabled = false,
  onChanged,
}: ProjectLocalBranchesEditorProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [watchBranch, setWatchBranch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/local-branches`);
      const json = (await res.json()) as LocalBranchesResponse & {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? "Failed to load local branches");
        return;
      }
      setBranches(json.branches);
      setCurrentBranch(json.currentBranch);
      setWatchBranch(json.watchBranch);
    } catch {
      setError("Failed to load local branches");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  function branchBlockedReason(branch: string): string | null {
    if (branch === watchBranch) return "Watch/deploy branch";
    if (branch === currentBranch) return "Currently checked out";
    return null;
  }

  async function deleteBranch(branch: string, force = false) {
    const blocked = branchBlockedReason(branch);
    if (blocked) {
      alert(`Cannot delete: ${blocked}`);
      return;
    }

    const label = force
      ? `Force-delete local branch "${branch}"? This cannot be undone (remote unchanged).`
      : `Delete local branch "${branch}"? Remote branches are not affected.`;
    if (!confirm(label)) return;

    setBusyBranch(branch);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/local-branches`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, force }),
      });
      const json = (await res.json()) as { error?: string; code?: string };
      if (
        res.status === 409 &&
        json.code === NOT_FULLY_MERGED_CODE &&
        !force
      ) {
        if (
          confirm(
            `${json.error ?? "Branch is not fully merged."}\n\nForce-delete it anyway?`,
          )
        ) {
          await deleteBranch(branch, true);
        }
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Failed to delete branch");
        return;
      }
      setRenaming((prev) => (prev === branch ? null : prev));
      await load();
      await onChanged?.();
    } finally {
      setBusyBranch(null);
    }
  }

  async function saveRename(branch: string) {
    const newName = renameDraft.trim();
    if (!newName || newName === branch) {
      setRenaming(null);
      return;
    }
    if (!confirm(`Rename local branch "${branch}" to "${newName}"?`)) return;

    setBusyBranch(branch);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/local-branches`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, newName }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to rename branch");
        return;
      }
      setRenaming(null);
      await load();
      await onChanged?.();
    } finally {
      setBusyBranch(null);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
        Local branches
      </h2>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4">
        <p className="mb-3 text-sm text-zinc-500">
          Rename or delete local branches only. Remotes are unchanged. The
          watch/deploy branch and the current checkout are protected; active
          agents and deploys also block changes.
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">Loading branches…</p>
        ) : branches.length === 0 ? (
          <p className="text-sm text-zinc-500">No local branches found.</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {branches.map((branch) => {
              const blocked = branchBlockedReason(branch);
              const busy = busyBranch === branch || disabled;
              const isRenaming = renaming === branch;
              return (
                <li
                  key={branch}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    {isRenaming ? (
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        disabled={busy}
                        autoFocus
                        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500/50 disabled:opacity-50"
                      />
                    ) : (
                      <p className="truncate font-mono text-sm text-zinc-100">
                        {branch}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {branch === watchBranch && (
                        <span className="rounded border border-orange-400/20 bg-orange-400/10 px-1.5 py-0.5 text-[10px] text-orange-300">
                          watch
                        </span>
                      )}
                      {branch === currentBranch && (
                        <span className="rounded border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                          checked out
                        </span>
                      )}
                      {blocked && (
                        <span className="text-[10px] text-zinc-600">
                          {blocked}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isRenaming ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveRename(branch)}
                          className="rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setRenaming(null)}
                          className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy || Boolean(blocked)}
                          title={blocked ?? "Rename local branch"}
                          onClick={() => {
                            setRenameDraft(branch);
                            setRenaming(branch);
                            setError("");
                          }}
                          className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={busy || Boolean(blocked)}
                          title={blocked ?? "Delete local branch"}
                          onClick={() => void deleteBranch(branch)}
                          className="rounded-lg border border-red-400/20 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
