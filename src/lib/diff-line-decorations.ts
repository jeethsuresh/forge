export type DiffLineKind = "added" | "removed" | "modified";

export interface DiffLineDecoration {
  line: number;
  kind: DiffLineKind;
}

/** Inline deleted lines shown before a line in the editor (VS Code SCM style). */
export interface DiffInlineDeletion {
  beforeLine: number;
  text: string;
}

export interface ParsedFileDiffDecorations {
  lines: DiffLineDecoration[];
  inlineDeletions: DiffInlineDeletion[];
}

/**
 * Parse a unified diff patch for a single file into Monaco-friendly decorations.
 * `contentLineCount` is the number of lines in the displayed file content.
 */
export function parseFileDiffDecorations(
  patch: string,
  contentLineCount: number,
): ParsedFileDiffDecorations {
  const lines: DiffLineDecoration[] = [];
  const inlineDeletions: DiffInlineDeletion[] = [];

  if (!patch.trim()) {
    return { lines, inlineDeletions };
  }

  const patchLines = patch.split("\n");
  let newLine = 1;
  let pendingRemovals: string[] = [];
  let inHunk = false;

  function flushRemovals() {
    if (pendingRemovals.length === 0) return;
    inlineDeletions.push({
      beforeLine: Math.min(Math.max(newLine, 1), Math.max(contentLineCount, 1)),
      text: pendingRemovals.join("\n"),
    });
    pendingRemovals = [];
  }

  for (const line of patchLines) {
    if (line.startsWith("@@")) {
      flushRemovals();
      inHunk = true;
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      newLine = match ? Number.parseInt(match[1] ?? "1", 10) : 1;
      continue;
    }

    if (!inHunk) continue;
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) {
      continue;
    }

    if (line.startsWith("+")) {
      const hadRemovals = pendingRemovals.length > 0;
      if (hadRemovals) {
        inlineDeletions.push({
          beforeLine: Math.min(
            Math.max(newLine, 1),
            Math.max(contentLineCount, 1),
          ),
          text: pendingRemovals.join("\n"),
        });
        pendingRemovals = [];
      }
      const kind: DiffLineKind = hadRemovals ? "modified" : "added";
      if (newLine >= 1 && newLine <= contentLineCount) {
        lines.push({ line: newLine, kind });
      }
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      pendingRemovals.push(line.slice(1));
      continue;
    }

    if (line.startsWith("\\")) {
      continue;
    }

    flushRemovals();
    newLine += 1;
  }

  flushRemovals();

  return { lines, inlineDeletions };
}
