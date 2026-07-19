"use client";

import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiffInlineDeletion,
  ParsedFileDiffDecorations,
} from "@/lib/diff-line-decorations";

export interface ProjectDiffEditorFile {
  path: string;
  language: string;
  status: "added" | "modified" | "deleted" | "unchanged";
  binary: boolean;
  editable: boolean;
  content: string;
  originalContent: string | null;
  decorations: ParsedFileDiffDecorations;
}

interface ProjectDiffEditorProps {
  file: ProjectDiffEditorFile;
  loading?: boolean;
  saving?: boolean;
  onSave?: (content: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

const FORGE_EDITOR_THEME = "forge-diff-dark";

function defineForgeTheme(monaco: Monaco) {
  monaco.editor.defineTheme(FORGE_EDITOR_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#09090b",
      "editor.foreground": "#e4e4e7",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.selectionBackground": "#3f3f4644",
      "editor.inactiveSelectionBackground": "#3f3f4622",
      "editor.lineHighlightBackground": "#18181b",
      "editorCursor.foreground": "#fb923c",
      "editorIndentGuide.background": "#27272a",
      "editorIndentGuide.activeBackground": "#3f3f46",
      "diffEditor.insertedTextBackground": "#22c55e22",
      "diffEditor.removedTextBackground": "#ef444422",
    },
  });
}

function buildDecorations(
  monaco: Monaco,
  decorations: ParsedFileDiffDecorations,
): MonacoEditor.IModelDeltaDecoration[] {
  const result: MonacoEditor.IModelDeltaDecoration[] = [];

  for (const line of decorations.lines) {
    const className =
      line.kind === "added"
        ? "forge-diff-line-added"
        : line.kind === "modified"
          ? "forge-diff-line-modified"
          : "forge-diff-line-removed";
    const gutterClass =
      line.kind === "added"
        ? "forge-diff-gutter-added"
        : line.kind === "modified"
          ? "forge-diff-gutter-modified"
          : "forge-diff-gutter-removed";

    result.push({
      range: new monaco.Range(line.line, 1, line.line, 1),
      options: {
        isWholeLine: true,
        className,
        linesDecorationsClassName: gutterClass,
        overviewRuler: {
          color:
            line.kind === "added"
              ? "#22c55e99"
              : line.kind === "modified"
                ? "#f59e0b99"
                : "#ef444499",
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    });
  }

  for (const deletion of decorations.inlineDeletions) {
    result.push(
      inlineDeletionDecoration(monaco, deletion),
    );
  }

  return result;
}

function inlineDeletionDecoration(
  monaco: Monaco,
  deletion: DiffInlineDeletion,
): MonacoEditor.IModelDeltaDecoration {
  return {
    range: new monaco.Range(deletion.beforeLine, 1, deletion.beforeLine, 1),
    options: {
      before: {
        content: deletion.text,
        inlineClassName: "forge-diff-inline-removed",
        attachedData: deletion.text,
      },
      linesDecorationsClassName: "forge-diff-gutter-removed",
    },
  };
}

export function ProjectDiffEditor({
  file,
  loading = false,
  saving = false,
  onSave,
  onDirtyChange,
}: ProjectDiffEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const savedContentRef = useRef(file.content);
  const [draft, setDraft] = useState(file.content);
  const [dirty, setDirty] = useState(false);

  const readOnly = !file.editable || file.binary || file.status === "deleted";

  useEffect(() => {
    queueMicrotask(() => {
      savedContentRef.current = file.content;
      setDraft(file.content);
      setDirty(false);
      onDirtyChange?.(false);
    });
  }, [file.path, file.content, onDirtyChange]);

  const applyDecorations = useCallback(
    (monaco: Monaco, model: MonacoEditor.ITextModel) => {
      const editor = editorRef.current;
      if (!editor) return;
      decorationIdsRef.current = editor.deltaDecorations(
        decorationIdsRef.current,
        buildDecorations(monaco, file.decorations),
      );
      void model;
    },
    [file.decorations],
  );

  const handleMount = useCallback(
    (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      defineForgeTheme(monaco);
      monaco.editor.setTheme(FORGE_EDITOR_THEME);
      const model = editor.getModel();
      if (model) applyDecorations(monaco, model);
    },
    [applyDecorations],
  );

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (monaco && model) {
      applyDecorations(monaco, model);
    }
  }, [applyDecorations, file.decorations]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? "";
      setDraft(next);
      const isDirty = next !== savedContentRef.current;
      setDirty(isDirty);
      onDirtyChange?.(isDirty);
    },
    [onDirtyChange],
  );

  const handleSave = useCallback(async () => {
    if (!onSave || readOnly || !dirty) return;
    await onSave(draft);
    savedContentRef.current = draft;
    setDirty(false);
    onDirtyChange?.(false);
  }, [dirty, draft, onDirtyChange, onSave, readOnly]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const statusLabel = useMemo(() => {
    if (file.binary) return "Binary file";
    if (file.status === "deleted") return "Deleted";
    if (file.status === "added") return "Added";
    if (file.status === "modified") return "Modified";
    return "Unchanged";
  }, [file.binary, file.status]);

  if (file.binary) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-zinc-500">
        Binary file — open in an external tool to edit.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span
            className={`rounded border px-1.5 py-0.5 font-medium uppercase tracking-wide ${
              file.status === "added"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : file.status === "deleted"
                  ? "border-red-400/30 bg-red-400/10 text-red-300"
                  : file.status === "modified"
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                    : "border-zinc-700 text-zinc-500"
            }`}
          >
            {statusLabel}
          </span>
          <span className="truncate font-mono text-zinc-400">{file.path}</span>
          {dirty && (
            <span className="rounded border border-orange-400/30 bg-orange-400/10 px-1.5 py-0.5 text-orange-200">
              Unsaved
            </span>
          )}
        </div>
        {file.editable && onSave && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || saving || loading}
            className="min-h-8 rounded-lg border border-orange-400/40 bg-orange-400/10 px-3 py-1 text-xs font-medium text-orange-200 hover:bg-orange-400/20 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={file.language}
          value={draft}
          theme={FORGE_EDITOR_THEME}
          onChange={handleChange}
          onMount={handleMount}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Loading editor…
            </div>
          }
          options={{
            readOnly,
            minimap: { enabled: true, scale: 1 },
            fontSize: 13,
            lineHeight: 20,
            fontFamily:
              "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
            scrollBeyondLastLine: false,
            renderWhitespace: "selection",
            wordWrap: "off",
            automaticLayout: true,
            glyphMargin: true,
            lineNumbers: "on",
            folding: true,
            bracketPairColorization: { enabled: true },
            padding: { top: 12, bottom: 12 },
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
          }}
        />
      </div>
    </div>
  );
}
