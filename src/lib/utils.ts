import type { RuntimeStatus } from "@/lib/project-status";
import {
  runtimeTone,
  statusTone,
  toneBadgeClass,
  toneTextClass,
} from "@/lib/ui-status";

export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function formatDuration(
  start: Date | string | number,
  end?: Date | string | number | null,
): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.floor((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return "—";
  return sha.slice(0, 7);
}

export function statusColor(status: string): string {
  return toneBadgeClass(statusTone(status));
}

export function runtimeStatusLabel(status: RuntimeStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "stopped":
      return "Stopped";
    case "partial":
      return "Partially running";
    case "deploying":
      return "Deploying";
    case "not_deployed":
      return "Not deployed";
    case "unknown":
      return "Unknown";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function runtimeStatusColor(status: RuntimeStatus): string {
  const tone = runtimeTone(status);
  if (status === "not_deployed" || status === "unknown") {
    return "text-zinc-500";
  }
  return toneTextClass(tone);
}

export function runtimeStatusBadgeColor(status: RuntimeStatus): string {
  return toneBadgeClass(runtimeTone(status));
}
