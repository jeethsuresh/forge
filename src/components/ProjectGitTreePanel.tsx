"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitTreeBranch, GitTreeCommit } from "@/lib/project-git-tree";
import {
  mergeGitGraphPages,
  type ProjectGitGraph,
} from "@/lib/project-git-graph";
import { formatRelativeTime } from "@/lib/utils";

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

const COL_WIDTH = 52;
const LANE_HEIGHT = 36;
const GRAPH_PADDING_X = 20;
const GRAPH_PADDING_Y = 16;

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
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [rebaseTargets, setRebaseTargets] = useState<Record<string, string>>(
    {},
  );
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [mergeDeleteLocal, setMergeDeleteLocal] = useState<
    Record<string, boolean>
  >({});

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

  async function runRebase(branch: GitTreeBranch) {
    const onto = rebaseTargets[branch.name]?.trim();
    if (!onto) {
      alert("Choose a branch to rebase onto.");
      return;
    }
    if (
      !confirm(
        `Rebase "${branch.name}" onto "${onto}"?\n\nThe branch will be pushed to origin before rebasing.`,
      )
    ) {
      return;
    }

    setBusyBranch(branch.name);
    try {
      const res = await fetch(`/api/projects/${projectId}/git-tree/rebase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: branch.name, onto }),
      });
      const body = (await res.json()) as BranchOpsError;
      if (!res.ok) {
        await handleBranchOpError(res, body);
        return;
      }
      await refreshGraph();
      onRefreshProject?.();
    } finally {
      setBusyBranch(null);
    }
  }

  async function runMerge(branch: GitTreeBranch) {
    const into = mergeTargets[branch.name]?.trim();
    if (!into) {
      alert("Choose a branch to merge into.");
      return;
    }
    const deleteLocal = mergeDeleteLocal[branch.name] === true;
    const deleteNote = deleteLocal
      ? "\n\nThe local copy of the source branch will be deleted afterward (remote unchanged)."
      : "";
    if (
      !confirm(
        `Merge "${branch.name}" into "${into}"?\n\nThe source branch will be pushed to origin before merging.${deleteNote}`,
      )
    ) {
      return;
    }

    setBusyBranch(branch.name);
    try {
      const res = await fetch(`/api/projects/${projectId}/git-tree/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: branch.name,
          into,
          deleteLocal,
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
      setBusyBranch(null);
    }
  }

  const branches = graph?.branches ?? [];
  const branchNames = branches.map((branch) => branch.name);
  const layout = useMemo(
    () => (graph ? buildGraphLayout(graph) : null),
    [graph],
  );

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
          disabled={disabled || busyBranch !== null || loadingMore}
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
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="flex min-h-[12rem] flex-col lg:flex-row">
            <div className="shrink-0 divide-y divide-zinc-800 border-b border-zinc-800 lg:w-60 lg:border-b-0 lg:border-r">
              {branches.map((branch) => (
                <BranchControls
                  key={branch.name}
                  branch={branch}
                  branchNames={branchNames}
                  watchBranch={watchBranch}
                  disabled={disabled || busyBranch !== null}
                  busy={busyBranch === branch.name}
                  rebaseTarget={rebaseTargets[branch.name] ?? ""}
                  mergeTarget={mergeTargets[branch.name] ?? ""}
                  deleteLocal={mergeDeleteLocal[branch.name] === true}
                  onRebaseTargetChange={(value) =>
                    setRebaseTargets((prev) => ({
                      ...prev,
                      [branch.name]: value,
                    }))
                  }
                  onMergeTargetChange={(value) =>
                    setMergeTargets((prev) => ({
                      ...prev,
                      [branch.name]: value,
                    }))
                  }
                  onDeleteLocalChange={(checked) =>
                    setMergeDeleteLocal((prev) => ({
                      ...prev,
                      [branch.name]: checked,
                    }))
                  }
                  onRebase={() => void runRebase(branch)}
                  onMerge={() => void runMerge(branch)}
                />
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
                        opacity={0.85}
                      />
                    ))}
                  </svg>

                  {layout.nodes.map((node) => (
                    <div
                      key={node.sha}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: node.x, top: node.y }}
                    >
                      <CommitNode
                        commit={graph?.commits[node.sha]}
                        isHead={node.isHead}
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
      )}
    </section>
  );
}

function BranchControls({
  branch,
  branchNames,
  watchBranch,
  disabled,
  busy,
  rebaseTarget,
  mergeTarget,
  deleteLocal,
  onRebaseTargetChange,
  onMergeTargetChange,
  onDeleteLocalChange,
  onRebase,
  onMerge,
}: {
  branch: GitTreeBranch;
  branchNames: string[];
  watchBranch: string;
  disabled: boolean;
  busy: boolean;
  rebaseTarget: string;
  mergeTarget: string;
  deleteLocal: boolean;
  onRebaseTargetChange: (value: string) => void;
  onMergeTargetChange: (value: string) => void;
  onDeleteLocalChange: (checked: boolean) => void;
  onRebase: () => void;
  onMerge: () => void;
}) {
  const otherBranches = branchNames.filter((name) => name !== branch.name);

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-zinc-100">{branch.name}</span>
        {branch.isWatchBranch && (
          <span className="rounded border border-orange-400/20 bg-orange-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-orange-300">
            watch
          </span>
        )}
        {branch.unpushed && (
          <span className="rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
            unpushed
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          Rebase onto
        </span>
        <div className="flex gap-1">
          <select
            value={rebaseTarget}
            onChange={(e) => onRebaseTargetChange(e.target.value)}
            disabled={disabled || busy || otherBranches.length === 0}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 disabled:opacity-50"
          >
            <option value="">Select…</option>
            {otherBranches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRebase}
            disabled={disabled || busy || !rebaseTarget}
            className="min-h-9 shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? "…" : "Rebase"}
          </button>
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          Merge into
        </span>
        <div className="flex gap-1">
          <select
            value={mergeTarget}
            onChange={(e) => onMergeTargetChange(e.target.value)}
            disabled={disabled || busy || otherBranches.length === 0}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 disabled:opacity-50"
          >
            <option value="">Select…</option>
            {otherBranches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onMerge}
            disabled={disabled || busy || !mergeTarget}
            className="min-h-9 shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {busy ? "…" : "Merge"}
          </button>
        </div>
      </label>

      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={deleteLocal}
          onChange={(e) => onDeleteLocalChange(e.target.checked)}
          disabled={
            disabled ||
            busy ||
            branch.isWatchBranch ||
            branch.name === watchBranch
          }
          className="rounded border-zinc-600 bg-zinc-950"
        />
        Merge and delete branch (local only)
      </label>
    </div>
  );
}

const BRANCH_COLORS = [
  "#fb923c",
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#facc15",
];

function buildGraphLayout(graph: ProjectGitGraph) {
  const branchOrder = graph.branches.map((branch) => branch.name);
  const laneByBranch = new Map(
    branchOrder.map((name, index) => [name, index] as const),
  );
  const shaToColumn = new Map(
    graph.columns.map((sha, index) => [sha, index] as const),
  );
  const branchHeads = new Set(
    graph.branches.map((branch) => branch.headSha).filter(Boolean),
  );

  const nodeLanes = new Map<string, number[]>();
  for (const [branchName, path] of Object.entries(graph.branchPaths)) {
    const lane = laneByBranch.get(branchName);
    if (lane === undefined) continue;
    for (const sha of path) {
      const lanes = nodeLanes.get(sha) ?? [];
      lanes.push(lane);
      nodeLanes.set(sha, lanes);
    }
  }

  const nodes = graph.columns.map((sha) => {
    const column = shaToColumn.get(sha) ?? 0;
    const lanes = nodeLanes.get(sha) ?? [0];
    const lane =
      lanes.reduce((sum, value) => sum + value, 0) / Math.max(lanes.length, 1);
    return {
      sha,
      x: GRAPH_PADDING_X + column * COL_WIDTH,
      y: GRAPH_PADDING_Y + lane * LANE_HEIGHT + LANE_HEIGHT / 2,
      isHead: branchHeads.has(sha),
    };
  });

  const nodeBySha = new Map(nodes.map((node) => [node.sha, node] as const));
  const tracks = branchOrder.map((branchName, index) => {
    const path = graph.branchPaths[branchName] ?? [];
    const points = path
      .map((sha) => nodeBySha.get(sha))
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
    const pathData =
      points.length === 0
        ? ""
        : `M ${points.map((point) => `${point.x},${point.y}`).join(" L ")}`;
    return {
      branch: branchName,
      path: pathData,
      color: BRANCH_COLORS[index % BRANCH_COLORS.length] ?? "#94a3b8",
    };
  });

  const width =
    GRAPH_PADDING_X * 2 +
    Math.max(graph.columns.length - 1, 0) * COL_WIDTH +
    COL_WIDTH;
  const height =
    GRAPH_PADDING_Y * 2 +
    Math.max(branchOrder.length, 1) * LANE_HEIGHT;

  return {
    columns: graph.columns,
    nodes,
    tracks,
    width,
    height,
  };
}

function CommitNode({
  commit,
  isHead,
}: {
  commit: GitTreeCommit | undefined;
  isHead: boolean;
}) {
  if (!commit) {
    return (
      <div className="h-7 w-7 shrink-0 rounded-full border border-zinc-700 bg-zinc-950" />
    );
  }

  const title = `${commit.shortSha} — ${commit.subject}\n${commit.authorDate ? formatRelativeTime(commit.authorDate) : ""}`;

  return (
    <div
      title={title}
      className={`group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${
        isHead
          ? "border-orange-400/40 bg-orange-400/15 text-orange-200"
          : "border-zinc-600 bg-zinc-950 text-zinc-400"
      }`}
    >
      {commit.shortSha.slice(0, 4)}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-56 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-left text-[10px] normal-case text-zinc-300 shadow-lg group-hover:block">
        <div className="font-mono text-orange-300">{commit.shortSha}</div>
        <div className="mt-0.5 line-clamp-2">{commit.subject || "(no subject)"}</div>
        {commit.authorDate && (
          <div className="mt-1 text-zinc-500">
            {formatRelativeTime(commit.authorDate)}
          </div>
        )}
      </div>
    </div>
  );
}
