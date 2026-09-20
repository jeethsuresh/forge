"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { BranchEditorFileEntry } from "@/lib/branch-editor";
import type { ProjectDiffEditorFile } from "@/components/ProjectDiffEditor";
import { ProjectBranchFileTree } from "@/components/ProjectBranchFileTree";

const ProjectDiffEditor = dynamic(
  () =>
    import("@/components/ProjectDiffEditor").then((module) => ({
      default: module.ProjectDiffEditor,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Loading editor…
      </div>
    ),
  },
);

type ContainerStatus = "running" | "paused" | "stopped";

interface BranchEditorApiResponse {
  branch: string;
  watchBranch: string;
  branches: string[];
  files: BranchEditorFileEntry[];
  dirty: boolean;
  containerStatus: ContainerStatus;
  sessionId: string | null;
  sessionBranch: string | null;
  error?: string;
}

interface ProjectBranchEditorProps {
  projectId: string;
  watchBranch: string;
}

function containerStatusLabel(status: ContainerStatus | undefined): string {
  switch (status) {
    case "running":
      return "Branch checkout running";
    case "paused":
      return "Paused while an agent uses this branch";
    case "stopped":
      return "Checkout on disk; container stopped";
    case undefined:
      return "No checkout yet";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function ProjectBranchEditor({
  projectId,
  watchBranch,
}: ProjectBranchEditorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const [branch, setBranch] = useState(
    searchParams.get("branch") ?? watchBranch,
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(
    searchParams.get("file"),
  );
  const [data, setData] = useState<BranchEditorApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileData, setFileData] = useState<ProjectDiffEditorFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);

  const replaceUrl = useCallback(
    (next: { branch?: string; file?: string }) => {
      const params = new URLSearchParams();
      const nextBranch = next.branch ?? branch;
      const nextFile = next.file === undefined ? selectedFile : next.file;
      if (nextBranch) params.set("branch", nextBranch);
      if (sessionId) params.set("session", sessionId);
      if (nextFile) params.set("file", nextFile);
      const qs = params.toString();
      router.replace(
        qs
          ? `/projects/${projectId}/changes?${qs}`
          : `/projects/${projectId}/changes`,
        { scroll: false },
      );
    },
    [branch, selectedFile, sessionId, projectId, router],
  );

  const fetchTree = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (branch) params.set("branch", branch);
      if (sessionId) params.set("session", sessionId);
      const res = await fetch(
        `/api/projects/${projectId}/branch-editor?${params.toString()}`,
      );
      const json = (await res.json()) as BranchEditorApiResponse;
      if (!res.ok) {
        throw new Error(json.error || "Failed to load branch");
      }
      setError(null);
      setData(json);
      if (json.branch && json.branch !== branch) {
        setBranch(json.branch);
      }
      if (!selectedFile) {
        const first = json.files.find((file) => file.status !== "deleted");
        if (first) setSelectedFile(first.path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, branch, sessionId, selectedFile]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    if (sessionId) params.set("session", sessionId);
    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/branch-editor?${params.toString()}`,
        );
        const json = (await res.json()) as BranchEditorApiResponse;
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(json.error || "Failed to load branch");
        }
        setError(null);
        setData(json);
        if (json.branch && json.branch !== branch) {
          setBranch(json.branch);
        }
        const first = json.files.find((file) => file.status !== "deleted");
        if (first) setSelectedFile((current) => current ?? first.path);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, branch, sessionId]);

  useEffect(() => {
    if (!selectedFile) return;
    let cancelled = false;
    const params = new URLSearchParams({ branch, path: selectedFile });
    void (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/branch-editor/file?${params.toString()}`,
        );
        const json = (await res.json()) as {
          file?: ProjectDiffEditorFile;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.file) {
          throw new Error(json.error || "Failed to load file");
        }
        setFileData(json.file);
        setEditorDirty(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setFileData(null);
        }
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, branch, selectedFile]);

  const fetchFile = useCallback(
    async (path: string) => {
      const params = new URLSearchParams({ branch, path });
      const res = await fetch(
        `/api/projects/${projectId}/branch-editor/file?${params.toString()}`,
      );
      const json = (await res.json()) as {
        file?: ProjectDiffEditorFile;
        error?: string;
      };
      if (!res.ok || !json.file) {
        throw new Error(json.error || "Failed to load file");
      }
      setFileData(json.file);
      setEditorDirty(false);
    },
    [projectId, branch],
  );

  const saveFile = useCallback(
    async (content: string) => {
      if (!selectedFile) return;
      setSaving(true);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/branch-editor/file`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              branch,
              path: selectedFile,
              content,
            }),
          },
        );
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || "Save failed");
        await fetchTree();
        await fetchFile(selectedFile);
      } finally {
        setSaving(false);
      }
    },
    [projectId, branch, selectedFile, fetchTree, fetchFile],
  );

  const commitChanges = useCallback(async () => {
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/branch-editor/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch,
            message: commitMessage.trim() || undefined,
          }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Commit failed");
      setCommitMessage("");
      await fetchTree();
      if (selectedFile) await fetchFile(selectedFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [projectId, branch, commitMessage, fetchTree, fetchFile, selectedFile]);

  const branches = data?.branches ?? [watchBranch];

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4"
      data-testid="changes-panel"
    >
      <div className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              Changes
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Full tree for a branch checkout. Changed files are marked against{" "}
              {watchBranch}. Edit, save, then commit and push.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void fetchTree();
            }}
            disabled={loading}
            className="min-h-9 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[12rem] flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              Branch
            </span>
            <select
              aria-label="Branch"
              value={branch}
              onChange={(event) => {
                const next = event.target.value;
                setBranch(next);
                setSelectedFile(null);
                setFileData(null);
                replaceUrl({ branch: next, file: "" });
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
          <p className="text-xs text-zinc-400">
            {containerStatusLabel(data?.containerStatus)}
            {data?.dirty ? " · uncommitted changes" : ""}
          </p>
          {sessionId ? (
            <Link
              href={`/projects/${projectId}/agents?session=${sessionId}`}
              className="text-xs text-orange-400 hover:text-orange-300"
            >
              Open agent session
            </Link>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-4">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">
              Commit message
            </span>
            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Manual commit from Changes tab"
              className="min-h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
            />
          </label>
          <button
            type="button"
            onClick={() => void commitChanges()}
            disabled={committing || loading || editorDirty}
            className="min-h-9 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {committing ? "Committing…" : "Commit and push"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <ProjectBranchFileTree
          files={data?.files ?? []}
          selectedFile={selectedFile}
          changedOnly={changedOnly}
          onChangedOnlyChange={setChangedOnly}
          onSelect={(path) => {
            setSelectedFile(path);
            replaceUrl({ file: path });
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {fileData ? (
            <ProjectDiffEditor
              file={fileData}
              loading={fileLoading}
              saving={saving}
              onSave={saveFile}
              onDirtyChange={setEditorDirty}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              {loading ? "Loading branch…" : "Select a file"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
