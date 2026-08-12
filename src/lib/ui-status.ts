import type { RuntimeStatus } from "@/lib/project-status";

export type SemanticTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "accent";

const TONE_BADGE: Record<SemanticTone, string> = {
  success: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  warning: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  danger: "text-red-400 bg-red-400/10 border-red-400/20",
  info: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  neutral: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  accent: "text-orange-300 bg-orange-500/15 border-orange-500/30",
};

const TONE_DOT: Record<SemanticTone, string> = {
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  danger: "bg-red-400",
  info: "bg-cyan-400",
  neutral: "bg-zinc-500",
  accent: "bg-orange-500",
};

const TONE_TEXT: Record<SemanticTone, string> = {
  success: "text-emerald-400",
  warning: "text-amber-400",
  danger: "text-red-400",
  info: "text-cyan-400",
  neutral: "text-zinc-400",
  accent: "text-orange-400",
};

export function toneBadgeClass(tone: SemanticTone): string {
  return TONE_BADGE[tone];
}

export function toneDotClass(tone: SemanticTone): string {
  return TONE_DOT[tone];
}

export function toneTextClass(tone: SemanticTone): string {
  return TONE_TEXT[tone];
}

/** Map deployment / agent process statuses to semantic tone. */
export function statusTone(status: string): SemanticTone {
  switch (status) {
    case "success":
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "rolled_back":
    case "building":
    case "testing":
    case "deploying":
    case "staging":
    case "health_check":
    case "pulling":
    case "pending":
      return "warning";
    case "running":
      return "info";
    case "duplicate":
    case "cancelled":
    case "archived":
      return "neutral";
    default:
      return "neutral";
  }
}

export function runtimeTone(status: RuntimeStatus): SemanticTone {
  switch (status) {
    case "running":
      return "success";
    case "stopped":
      return "neutral";
    case "partial":
    case "deploying":
      return "warning";
    case "not_deployed":
    case "unknown":
      return "neutral";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
