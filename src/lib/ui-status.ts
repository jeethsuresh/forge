import type { RuntimeStatus } from "@/lib/project-status";

export type SemanticTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "accent";

const TONE_BADGE: Record<SemanticTone, string> = {
  success: "forge-status-pill forge-tone-success",
  warning: "forge-status-pill forge-tone-warning",
  danger: "forge-status-pill forge-tone-danger",
  info: "forge-status-pill forge-tone-info",
  neutral: "forge-status-pill forge-tone-neutral",
  accent: "forge-status-pill forge-tone-accent",
};

const TONE_DOT: Record<SemanticTone, string> = {
  success: "bg-[var(--forge-success)] text-[var(--forge-success)]",
  warning: "bg-[var(--forge-warning)] text-[var(--forge-warning)]",
  danger: "bg-[var(--forge-danger)] text-[var(--forge-danger)]",
  info: "bg-[var(--forge-info)] text-[var(--forge-info)]",
  neutral: "bg-[var(--forge-neutral)] text-[var(--forge-neutral)]",
  accent: "bg-[var(--forge-accent)] text-[var(--forge-accent)]",
};

const TONE_TEXT: Record<SemanticTone, string> = {
  success: "text-[var(--forge-success)]",
  warning: "text-[var(--forge-warning)]",
  danger: "text-[var(--forge-danger)]",
  info: "text-[var(--forge-info)]",
  neutral: "text-[var(--forge-muted)]",
  accent: "text-[var(--forge-accent)]",
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
