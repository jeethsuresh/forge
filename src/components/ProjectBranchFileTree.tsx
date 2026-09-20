"use client";

import type { BranchEditorFileEntry } from "@/lib/branch-editor";

export interface BranchFileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  status?: BranchEditorFileEntry["status"];
  children?: BranchFileTreeNode[];
}

export function buildBranchFileTree(
  files: BranchEditorFileEntry[],
): BranchFileTreeNode[] {
  const root: BranchFileTreeNode[] = [];

  function dirAt(parent: BranchFileTreeNode[], name: string, path: string) {
    let node = parent.find((child) => child.type === "dir" && child.name === name);
    if (!node) {
      node = { name, path, type: "dir", children: [] };
      parent.push(node);
    }
    return node;
  }

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let parent = root;
    let prefix = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      prefix = prefix ? `${prefix}/${name}` : name;
      const isFile = i === parts.length - 1;
      if (isFile) {
        parent.push({
          name,
          path: file.path,
          type: "file",
          status: file.status,
        });
      } else {
        const dir = dirAt(parent, name, prefix);
        parent = dir.children ?? [];
        dir.children = parent;
      }
    }
  }

  function sortNodes(nodes: BranchFileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
  }
  sortNodes(root);
  return root;
}

function statusLabel(status: BranchEditorFileEntry["status"] | undefined) {
  if (!status || status === "unchanged") return "";
  if (status === "modified") return "M";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "untracked") return "U";
  return "";
}

function TreeItems({
  nodes,
  selectedFile,
  onSelect,
}: {
  nodes: BranchFileTreeNode[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        if (node.type === "dir") {
          return (
            <li key={`dir:${node.path}`}>
              <details open>
                <summary className="cursor-pointer truncate rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800">
                  {node.name}
                </summary>
                <div className="ml-3 border-l border-zinc-800 pl-1">
                  <TreeItems
                    nodes={node.children ?? []}
                    selectedFile={selectedFile}
                    onSelect={onSelect}
                  />
                </div>
              </details>
            </li>
          );
        }
        const mark = statusLabel(node.status);
        const changed = Boolean(mark);
        return (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={`flex min-h-8 w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-xs ${
                selectedFile === node.path
                  ? "bg-orange-400/10 text-orange-100"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <span className="truncate">{node.name}</span>
              {changed ? (
                <span
                  className={`shrink-0 font-mono text-[10px] ${
                    mark === "D"
                      ? "text-red-400"
                      : mark === "A" || mark === "U"
                        ? "text-emerald-400"
                        : "text-amber-300"
                  }`}
                >
                  {mark}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ProjectBranchFileTreeProps {
  files: BranchEditorFileEntry[];
  selectedFile: string | null;
  changedOnly: boolean;
  onChangedOnlyChange: (value: boolean) => void;
  onSelect: (path: string) => void;
}

export function ProjectBranchFileTree({
  files,
  selectedFile,
  changedOnly,
  onChangedOnlyChange,
  onSelect,
}: ProjectBranchFileTreeProps) {
  const visible = changedOnly
    ? files.filter((file) => file.status !== "unchanged")
    : files;
  const tree = buildBranchFileTree(visible);

  return (
    <div className="flex min-h-0 min-w-[14rem] flex-col border-r border-zinc-800 bg-zinc-950/60">
      <label className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          checked={changedOnly}
          onChange={(event) => onChangedOnlyChange(event.target.checked)}
        />
        Changed only
      </label>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {tree.length === 0 ? (
          <p className="px-1 text-xs text-zinc-500">No files</p>
        ) : (
          <TreeItems
            nodes={tree}
            selectedFile={selectedFile}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}
