"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { GitTreeCommit } from "@/lib/project-git-tree";
import {
  mergeGitGraphPages,
  type ProjectGitGraph,
} from "@/lib/project-git-graph";
import {
  buildGraphLayout,
  LANE_HEIGHT,
  type GraphPreviewOp,
} from "@/lib/project-git-graph-layout";
import { formatRelativeTime } from "@/lib/utils";
import {
  branchVsMainDiffHref,
  mergePreviewDiffHref,
  rebasePreviewDiffHref,
} from "@/lib/project-diff-url";

interface GitGraphResponse {
  graph: ProjectGitGraph;
  forgeProject?: boolean;
  error?: string;
}

interface BranchOpsError {
  error?: string;
  blockingAgentSession?: {
    id: string;
    branch: string;
    status: string;
  } | null;
}

interface ProjectGitTreePanelProps {
  projectId: string;
  watchBranch: string;
  disabled?: boolean;
  onRefreshProject?: () => void;
  onOpenAgentSession?: (sessionId: string) => void;
}

export function ProjectGitTreePanel({
  projectId,
  watchBranch,
  disabled = false,
  onRefreshProject,
  onOpenAgentSession,
}: ProjectGitTreePanelProps) {
  const [graph, setGraph] = useState<ProjectGitGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeDeleteLocal, setMergeDeleteLocal] = useState(false);
  const [rebaseSource, setRebaseSource] = useState("");
  const [rebaseOnto, setRebaseOnto] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(
    async (skip: number, append: boolean) => {
      const res = await fetch(
        `/api/projects/${projectId}/git-tree?skip=${skip}`,
      );
      const body = (await res.json()) as GitGraphResponse;
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to load branch graph");
      }
      setGraph((prev) => {
        if (!append || !prev) return body.graph;
        return mergeGitGraphPages(prev, body.graph);
      });
      setError(null);
    },
    [projectId],
  );

  const refreshGraph = useCallback(async () => {
    setLoading(true);
    try {
      await fetchPage(0, false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load branch graph",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!graph?.hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      await fetchPage(graph.columns.length, true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load older commits",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, graph, loading, loadingMore]);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshGraph();
    });
  }, [refreshGraph]);

  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !graph?.hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root, rootMargin: "120px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [graph?.hasMore, graph?.columns.length, loadMore]);

  async function handleBranchOpError(res: Response, body: BranchOpsError) {
    if (res.status === 409 && body.blockingAgentSession && onOpenAgentSession) {
      const { id, branch, status } = body.blockingAgentSession;
      if (
        confirm(
          `${body.error ?? "Operation blocked"}\n\nOpen the agent on branch ${branch} (${status})?`,
        )
      ) {
        onOpenAgentSession(id);
      }
      return;
    }
    alert(body.error ?? "Branch operation failed");
  }

  async function runRebase() {
    const branch = rebaseSource.trim();
    const onto = rebaseOnto.trim();
    if (!branch || !onto) {
      alert("Choose both branches for rebase.");
      return;
    }
    if (
      !confirm(
        `Rebase "${branch}" onto "${onto}"?\n\nThe branch will be pushed to origin before rebasing.`,
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/git-tree/rebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, onto }),
      });
      const body = (await res.json()) as BranchOpsError;
      if (!res.ok) {
        await handleBranchOpError(res, body);
        return;
      }
      await refreshGraph();
      onRefreshProject?.();
    } finally {
      setBusy(false);
    }
  }

  async function runMerge() {
    const branch = mergeSource.trim();
    const into = mergeTarget.trim();
    if (!branch || !into) {
      alert("Choose both branches for merge.");
      return;
    }
    const deleteNote = mergeDeleteLocal
      ? "\n\nThe local copy of the source branch will be deleted afterward (remote unchanged)."
      : "";
    if (
      !confirm(
        `Merge "${branch}" into "${into}"?\n\nThe source branch will be pushed to origin before merging.${deleteNote}`,
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/git-tree/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          into,
          deleteLocal: mergeDeleteLocal,
        }),
      });
      const body = (await res.json()) as BranchOpsError;
      if (!res.ok) {
        await handleBranchOpError(res, body);
        return;
      }
      await refreshGraph();
      onRefreshProject?.();
    } finally {
      setBusy(false);
    }
  }

  const branches = graph?.branches ?? [];
  const branchNames = branches.map((branch) => branch.name);

  const previewOp = useMemo((): GraphPreviewOp => {
    if (mergeSource && mergeTarget && mergeSource !== mergeTarget) {
      return { kind: "merge", source: mergeSource, target: mergeTarget };
    }
    if (rebaseSource && rebaseOnto && rebaseSource !== rebaseOnto) {
      return { kind: "rebase", source: rebaseSource, onto: rebaseOnto };
    }
    return null;
  }, [mergeSource, mergeTarget, rebaseSource, rebaseOnto]);

  const layout = useMemo(
    () => (graph ? buildGraphLayout(graph, previewOp) : null),
    [graph, previewOp],
  );

  const mergeDeleteDisabled =
    !mergeSource ||
    mergeSource === watchBranch ||
    branches.find((b) => b.name === mergeSource)?.isWatchBranch === true;

  if (loading) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
          Branch graph
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-500">
          Loading branch graph…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">
          Branch graph
        </h2>
        <div className="rounded-xl border border-red-400/20 bg-zinc-900 px-4 py-6 text-center text-sm text-red-300">
          {error}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Branch graph
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            One timeline across all branches. Scroll right to load older commits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void refreshGraph().finally(() => setLoading(false));
          }}
          disabled={disabled || busy || loadingMore}
          className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          Refresh graph
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-600">
          No local branches found in the clone.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Merge & rebase
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Changing the dropdowns previews the result on the graph below.
            </p>

            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400">Merge</span>
                <select
                  value={mergeSource}
                  onChange={(e) => {
                    setMergeSource(e.target.value);
                    setRebaseSource("");
                    setRebaseOnto("");
                  }}
                  disabled={disabled || busy}
                  className="min-h-9 min-w-[10rem] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 disabled:opacity-50"
                >
                  <option value="">Select…</option>
                  {branchNames.map((name) => (
                    <option key={`merge-src-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-400">into</span>
                <select
                  value={mergeTarget}
                  onChange={(e) => {
                    setMergeTarget(e.target.value);
                    setRebaseSource("");
                    setRebaseOnto("");
                  }}
                  disabled={disabled || busy || !mergeSource}
                  className="min-h-9 min-w-[10rem] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 disabled:opacity-50"
                >
                  <option value="">Select…</option>
                  {branchNames
                    .filter((name) => name !== mergeSource)
                    .map((name) => (
                      <option key={`merge-tgt-${name}`} value={name}>
                        {name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => void runMerge()}
                  disabled={
                    disabled || busy || !mergeSource || !mergeTarget
                  }
                  className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  {busy ? "…" : "Merge"}
                </button>
                {mergeSource && mergeTarget && (
                  <Link
                    href={mergePreviewDiffHref(
                      projectId,
                      mergeSource,
                      mergeTarget,
                    )}
                    className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-400/10 px-3 py-1.5 text-xs text-orange-300 hover:bg-orange-400/20"
                  >
                    Preview changes
                  </Link>
                )}
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={mergeDeleteLocal}
                    onChange={(e) => setMergeDeleteLocal(e.target.checked)}
                    disabled={disabled || busy || mergeDeleteDisabled}
                    className="rounded border-zinc-600 bg-zinc-950"
                  />
                  Delete source locally after merge
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400">Rebase</span>
                <select
                  value={rebaseSource}
                  onChange={(e) => {
                    setRebaseSource(e.target.value);
                    setMergeSource("");
                    setMergeTarget("");
                  }}
                  disabled={disabled || busy}
                  className="min-h-9 min-w-[10rem] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 disabled:opacity-50"
                >
                  <option value="">Select…</option>
                  {branchNames.map((name) => (
                    <option key={`rebase-src-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-400">onto</span>
                <select
                  value={rebaseOnto}
                  onChange={(e) => {
                    setRebaseOnto(e.target.value);
                    setMergeSource("");
                    setMergeTarget("");
                  }}
                  disabled={disabled || busy || !rebaseSource}
                  className="min-h-9 min-w-[10rem] rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 disabled:opacity-50"
                >
                  <option value="">Select…</option>
                  {branchNames
                    .filter((name) => name !== rebaseSource)
                    .map((name) => (
                      <option key={`rebase-onto-${name}`} value={name}>
                        {name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => void runRebase()}
                  disabled={
                    disabled || busy || !rebaseSource || !rebaseOnto
                  }
                  className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  {busy ? "…" : "Rebase"}
                </button>
                {rebaseSource && rebaseOnto && (
                  <Link
                    href={rebasePreviewDiffHref(
                      projectId,
                      rebaseSource,
                      rebaseOnto,
                    )}
                    className="min-h-9 rounded-lg border border-orange-400/30 bg-orange-400/10 px-3 py-1.5 text-xs text-orange-300 hover:bg-orange-400/20"
                  >
                    Preview changes
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900">
            <div className="flex min-h-[12rem] flex-col lg:flex-row">
              <div className="shrink-0 border-b border-zinc-800 lg:w-56 lg:border-b-0 lg:border-r">
                {branches.map((branch) => (
                  <div
                    key={branch.name}
                    className="flex items-center gap-2 px-4"
                    style={{ height: LANE_HEIGHT }}
                  >
                    <span className="truncate font-mono text-xs text-zinc-100">
                      {branch.name}
                    </span>
                    {branch.isWatchBranch && (
                      <span className="shrink-0 rounded border border-orange-400/20 bg-orange-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-orange-300">
                        watch
                      </span>
                    )}
                    {branch.unpushed && (
                      <span className="shrink-0 rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                        unpushed
                      </span>
                    )}
                    {!branch.isWatchBranch && (
                      <Link
                        href={branchVsMainDiffHref(projectId, branch.name)}
                        className="shrink-0 text-[10px] text-orange-400/80 hover:text-orange-300"
                      >
                        diff
                      </Link>
                    )}
                  </div>
                ))}
              </div>

              <div
                ref={scrollRef}
                className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
              >
                {layout && layout.columns.length > 0 ? (
                  <div
                    className="relative"
                    style={{
                      width: layout.width,
                      height: layout.height,
                    }}
                  >
                    <svg
                      className="pointer-events-none absolute inset-0"
                      width={layout.width}
                      height={layout.height}
                      aria-hidden
                    >
                      {layout.tracks.map((track) => (
                        <path
                          key={track.branch}
                          d={track.path}
                          fill="none"
                          stroke={track.color}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={track.dashed ? "6 4" : undefined}
                          opacity={track.dashed ? 0.95 : 0.85}
                        />
                      ))}
                    </svg>

                    {layout.nodes.map((node) => (
                      <div
                        key={`${node.sha}-${node.x}-${node.y}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: node.x, top: node.y }}
                      >
                        <CommitNode
                          commit={graph?.commits[node.sha]}
                          isHead={node.isHead}
                          preview={!graph?.commits[node.sha]}
                        />
                      </div>
                    ))}

                    <div
                      ref={sentinelRef}
                      className="absolute top-0 h-full w-px"
                      style={{ left: layout.width - 1 }}
                      aria-hidden
                    />
                  </div>
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-zinc-600">
                    No commits loaded yet.
                  </div>
                )}

                {loadingMore && (
                  <div className="border-t border-zinc-800 px-4 py-2 text-center text-xs text-zinc-500">
                    Loading older commits…
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CommitNode({
  commit,
  isHead,
  preview = false,
}: {
  commit: GitTreeCommit | undefined;
  isHead: boolean;
  preview?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
    placeBelow: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setCoords(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const placeBelow = rect.top < 120;
    setCoords({
      left: rect.left + rect.width / 2,
      top: placeBelow ? rect.bottom + 8 : rect.top - 8,
      placeBelow,
    });
  }, [open]);

  if (!commit && !preview) {
    return (
      <div className="h-7 w-7 shrink-0 rounded-full border border-zinc-700 bg-zinc-950" />
    );
  }

  if (!commit) {
    return (
      <div className="h-6 w-6 shrink-0 rounded-full border border-dashed border-amber-400/50 bg-amber-400/10" />
    );
  }

  const title = `${commit.shortSha} — ${commit.subject}`;

  return (
    <>
      <div
        ref={anchorRef}
        title={title}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] outline-none ${
          isHead
            ? "border-orange-400/40 bg-orange-400/15 text-orange-200"
            : "border-zinc-600 bg-zinc-950 text-zinc-400"
        }`}
      >
        {commit.shortSha.slice(0, 4)}
      </div>
      {open &&
        coords &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[100] w-56 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-left text-[10px] normal-case text-zinc-300 shadow-lg"
            style={{
              left: coords.left,
              top: coords.top,
              transform: coords.placeBelow
                ? "translate(-50%, 0)"
                : "translate(-50%, -100%)",
            }}
            role="tooltip"
          >
            <div className="font-mono text-orange-300">{commit.shortSha}</div>
            <div className="mt-0.5 whitespace-normal break-words">
              {commit.subject || "(no subject)"}
            </div>
            {commit.authorDate && (
              <div className="mt-1 text-zinc-500">
                {formatRelativeTime(commit.authorDate)}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
