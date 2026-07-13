"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiffFileStat, ProjectGitDiffResult } from "@/lib/project-git-diff";
import type { ProjectDiffMode } from "@/lib/project-diff-url";
import { shortSha } from "@/lib/utils";

interface DiffApiResponse {
  diff: ProjectGitDiffResult;
  branches: string[];
  watchBranch: string;
  sessionId: string | null;
  sessionBranch: string | null;
  error?: string;
}

interface ProjectDiffPanelProps {
  projectId: string;
  watchBranch: string;
}

const MODE_OPTIONS: Array<{ value: ProjectDiffMode; label: string }> = [
  { value: "uncommitted", label: "Uncommitted" },
  { value: "branch-vs-main", label: "Branch vs watch" },
  { value: "range", label: "Commit range" },
  { value: "rebase", label: "Rebase preview" },
  { value: "merge", label: "Merge preview" },
];

function readMode(searchParams: URLSearchParams): ProjectDiffMode {
  const raw = searchParams.get("mode");
  if (
    raw === "uncommitted" ||
    raw === "range" ||
    raw === "branch-vs-main" ||
    raw === "rebase" ||
    raw === "merge"
  ) {
    return raw;
  }
  if (searchParams.get("session")) return "uncommitted";
  if (searchParams.get("source") && searchParams.get("onto")) return "rebase";
  if (searchParams.get("source") && searchParams.get("target")) return "merge";
  if (searchParams.get("branch")) return "branch-vs-main";
  if (searchParams.get("base") && searchParams.get("head")) return "range";
  return "uncommitted";
}

export function ProjectDiffPanel({
  projectId,
  watchBranch,
}: ProjectDiffPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<DiffApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(
    searchParams.get("file"),
  );

  const mode = readMode(searchParams);
  const sessionId = searchParams.get("session");
  const [base, setBase] = useState(searchParams.get("base") ?? "");
  const [head, setHead] = useState(searchParams.get("head") ?? "");
  const [branch, setBranch] = useState(
    searchParams.get("branch") ?? watchBranch,
  );
  const [source, setSource] = useState(searchParams.get("source") ?? "");
  const [onto, setOnto] = useState(searchParams.get("onto") ?? watchBranch);
  const [target, setTarget] = useState(
    searchParams.get("target") ?? watchBranch,
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (sessionId) params.set("session", sessionId);
    if (mode === "range") {
      if (base) params.set("base", base);
      if (head) params.set("head", head);
    }
    if (mode === "branch-vs-main" && branch) params.set("branch", branch);
    if (mode === "rebase") {
      if (source) params.set("source", source);
      if (onto) params.set("onto", onto);
    }
    if (mode === "merge") {
      if (source) params.set("source", source);
      if (target) params.set("target", target);
    }
    if (selectedFile) params.set("file", selectedFile);
    return params.toString();
  }, [mode, sessionId, base, head, branch, source, onto, target, selectedFile]);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/diff?${queryString}`);
      const json = (await res.json()) as DiffApiResponse;
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load diff");
      }
      setData(json);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Failed to load diff");
    } finally {
      setLoading(false);
    }
  }, [projectId, queryString]);

  useEffect(() => {
    void fetchDiff();
  }, [fetchDiff]);

  useEffect(() => {
    setSelectedFile(searchParams.get("file"));
    setBase(searchParams.get("base") ?? "");
    setHead(searchParams.get("head") ?? "");
    setBranch(searchParams.get("branch") ?? watchBranch);
    setSource(searchParams.get("source") ?? "");
    setOnto(searchParams.get("onto") ?? watchBranch);
    setTarget(searchParams.get("target") ?? watchBranch);
  }, [searchParams, watchBranch]);

  function replaceDiffUrl(
    updates: Partial<{
      mode: ProjectDiffMode;
      base: string;
      head: string;
      branch: string;
      source: string;
      onto: string;
      target: string;
      session: string;
      file: string;
    }>,
  ) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "diff");

    const keys = [
      "mode",
      "base",
      "head",
      "branch",
      "source",
      "onto",
      "target",
      "session",
      "file",
    ] as const;

    for (const key of keys) {
      if (key in updates) {
        const value = updates[key];
        if (value) next.set(key, value);
        else next.delete(key);
      }
    }

    router.replace(`/projects/${projectId}?${next.toString()}`, {
      scroll: false,
    });
  }

  function selectFile(path: string | null) {
    setSelectedFile(path);
    replaceDiffUrl({ file: path ?? "" });
  }

  const diff = data?.diff;
  const branches = data?.branches ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              Changes
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Compare commits, preview merge/rebase impact, or inspect uncommitted
              agent work. This view is linkable from agent sessions and branch
              operations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchDiff()}
            disabled={loading}
            className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => replaceDiffUrl({ mode: option.value, file: "" })}
              className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs ${
                mode === option.value
                  ? "border-orange-400/40 bg-orange-400/10 text-orange-200"
                  : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          {mode === "uncommitted" && (
            <p className="text-xs text-zinc-400">
              {sessionId ? (
                <>
                  Agent session{" "}
                  <span className="font-mono text-zinc-300">
                    {sessionId.slice(0, 8)}
                  </span>
                  {data?.sessionBranch ? (
                    <>
                      {" "}
                      on{" "}
                      <span className="font-mono text-orange-300">
                        {data.sessionBranch}
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                "Shows uncommitted changes in the checked-out workspace."
              )}
            </p>
          )}

          {mode === "branch-vs-main" && (
            <>
              <label className="flex min-w-[12rem] flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Branch
                </span>
                <select
                  value={branch}
                  onChange={(e) => {
                    setBranch(e.target.value);
                    replaceDiffUrl({ branch: e.target.value, file: "" });
                  }}
                  className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200"
                >
                  {branches.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-zinc-500">
                Compared against watch branch{" "}
                <span className="font-mono text-orange-300">{watchBranch}</span>
              </p>
            </>
          )}

          {mode === "range" && (
            <>
              <label className="flex min-w-[10rem] flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Base
                </span>
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  onBlur={() => replaceDiffUrl({ base, head, file: "" })}
                  placeholder="commit or branch"
                  className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200"
                />
              </label>
              <label className="flex min-w-[10rem] flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Head
                </span>
                <input
                  value={head}
                  onChange={(e) => setHead(e.target.value)}
                  onBlur={() => replaceDiffUrl({ base, head, file: "" })}
                  placeholder="commit or branch"
                  className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200"
                />
              </label>
            </>
          )}

          {mode === "rebase" && (
            <>
              <label className="flex min-w-[10rem] flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Rebase branch
                </span>
                <select
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    replaceDiffUrl({ source: e.target.value, onto, file: "" });
                  }}
                  className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200"
                >
                  <option value="">Select…</option>
                  {branches.map((name) => (
                    <option key={`rebase-src-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[10rem] flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Onto
                </span>
                <select
                  value={onto}
                  onChange={(e) => {
                    setOnto(e.target.value);
                    replaceDiffUrl({ source, onto: e.target.value, file: "" });
                  }}
                  className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200"
                >
                  {branches.map((name) => (
                    <option key={`rebase-onto-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {mode === "merge" && (
            <>
              <label className="flex min-w-[10rem] flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Source
                </span>
                <select
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    replaceDiffUrl({
                      source: e.target.value,
                      target,
                      file: "",
                    });
                  }}
                  className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200"
                >
                  <option value="">Select…</option>
                  {branches.map((name) => (
                    <option key={`merge-src-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[10rem] flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Target
                </span>
                <select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    replaceDiffUrl({
                      source,
                      target: e.target.value,
                      file: "",
                    });
                  }}
                  className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200"
                >
                  {branches.map((name) => (
                    <option key={`merge-tgt-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {diff && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="rounded border border-zinc-700 px-2 py-1 text-zinc-300">
              {diff.label}
            </span>
            {diff.baseSha && (
              <span>
                base {shortSha(diff.baseSha)}
                {diff.baseRef ? ` (${diff.baseRef})` : ""}
              </span>
            )}
            {diff.headSha && (
              <span>
                head {shortSha(diff.headSha)}
                {diff.headRef ? ` (${diff.headRef})` : ""}
              </span>
            )}
            {sessionId && (
              <Link
                href={`/projects/${projectId}?tab=agents&session=${sessionId}`}
                className="text-orange-400 hover:text-orange-300"
              >
                Open agent session
              </Link>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {diff?.warning && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
          {diff.warning}
        </div>
      )}

      {loading && !diff ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-zinc-800 text-sm text-zinc-500">
          Loading diff…
        </div>
      ) : diff ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Files ({diff.files.length})
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {diff.files.length === 0 ? (
                <p className="px-3 py-4 text-xs text-zinc-600">No file changes</p>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  <li>
                    <button
                      type="button"
                      onClick={() => selectFile(null)}
                      className={`flex w-full flex-col px-3 py-2 text-left text-xs hover:bg-zinc-800/60 ${
                        !selectedFile ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400"
                      }`}
                    >
                      All files
                    </button>
                  </li>
                  {diff.files.map((fileStat) => (
                    <li key={fileStat.path}>
                      <FileListButton
                        file={fileStat}
                        active={selectedFile === fileStat.path}
                        onSelect={() => selectFile(fileStat.path)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 px-4 py-2 text-xs text-zinc-500">
              {diff.empty
                ? "No differences"
                : selectedFile
                  ? selectedFile
                  : "Unified diff"}
              {diff.truncated ? " · truncated" : ""}
            </div>
            <DiffPatchView patch={diff.patch} empty={diff.empty} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function FileListButton({
  file,
  active,
  onSelect,
}: {
  file: DiffFileStat;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs hover:bg-zinc-800/60 ${
        active ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400"
      }`}
    >
      <span className="break-all font-mono">{file.path}</span>
      <span className="text-[10px] text-zinc-500">
        {file.binary ? "binary" : `+${file.insertions} -${file.deletions}`}
      </span>
    </button>
  );
}

function DiffPatchView({ patch, empty }: { patch: string; empty: boolean }) {
  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-zinc-600">
        No changes to show for this comparison.
      </div>
    );
  }

  const lines = patch.split("\n");

  return (
    <pre className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 font-mono text-[11px] leading-relaxed">
      {lines.map((line, index) => (
        <div
          key={`${index}-${line.slice(0, 12)}`}
          className={
            line.startsWith("+") && !line.startsWith("+++")
              ? "text-emerald-300/90"
              : line.startsWith("-") && !line.startsWith("---")
                ? "text-red-300/90"
                : line.startsWith("@@")
                  ? "text-sky-300/80"
                  : "text-zinc-400"
          }
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
