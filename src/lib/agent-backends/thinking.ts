import type { ThinkingLevel, ThinkingResolution } from "@/lib/agent-backends/types";

const DEFAULT_CURSOR_MODEL = "gpt-5.5";

export function normalizeBaseModel(model: string | null | undefined): string {
  const trimmed = model?.trim() ?? "";
  return trimmed || DEFAULT_CURSOR_MODEL;
}

export function modelAlreadyHasThinking(model: string): boolean {
  return /extra-high$|thinking-high$|-high$|-xhigh$/i.test(model.trim());
}

export function thinkingLevelFromModel(model: string): ThinkingLevel {
  const id = model.trim().toLowerCase();
  if (id.includes("extra-high") || id.endsWith("-xhigh") || id.includes("xhigh")) {
    return "xhigh";
  }
  if (id.includes("thinking-high") || id.endsWith("-high") || id.includes("high")) {
    return "high";
  }
  return "none";
}

export function cursorModelCandidates(model: string): ThinkingResolution[] {
  const raw = model.trim();
  if (raw && modelAlreadyHasThinking(raw)) {
    return [
      {
        level: thinkingLevelFromModel(raw),
        modelId: raw,
        extraArgs: ["--model", raw],
      },
    ];
  }

  const base = normalizeBaseModel(raw);
  if (/claude/i.test(base)) {
    const high = `${base}-thinking-high`;
    return [
      {
        level: "high",
        modelId: high,
        extraArgs: ["--model", high],
        note: "Claude models use thinking-high (no extra-high variant).",
      },
    ];
  }

  const xhigh = `${base}-extra-high`;
  const high = `${base}-high`;
  return [
    {
      level: "xhigh",
      modelId: xhigh,
      extraArgs: ["--model", xhigh],
    },
    {
      level: "high",
      modelId: high,
      extraArgs: ["--model", high],
    },
  ];
}

export function pickCursorThinkingModel(
  model: string,
  availableIds?: string[],
): ThinkingResolution {
  const candidates = cursorModelCandidates(model);
  if (!availableIds || availableIds.length === 0) {
    return candidates[0]!;
  }
  const lower = new Set(availableIds.map((id) => id.toLowerCase()));
  for (const candidate of candidates) {
    if (candidate.modelId && lower.has(candidate.modelId.toLowerCase())) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export function codexReasoningArgs(level: "xhigh" | "high"): string[] {
  return ["-c", `model_reasoning_effort=${level}`];
}

export function localReasoningEfforts(): Array<"xhigh" | "high"> {
  return ["xhigh", "high"];
}
