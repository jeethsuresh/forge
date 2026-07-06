import type { RuntimeStatus } from "@/lib/project-status";

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
  switch (status) {
    case "success":
      return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
    case "duplicate":
      return "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
    case "failed":
      return "text-red-400 bg-red-400/10 border-red-400/20";
    case "building":
    case "testing":
    case "deploying":
    case "pulling":
    case "pending":
    case "running":
    case "deploying":
      return "text-amber-400 bg-amber-400/10 border-amber-400/20";
    case "completed":
      return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
    case "cancelled":
      return "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
    default:
      return "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
  }
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
  switch (status) {
    case "running":
      return "text-emerald-400";
    case "stopped":
      return "text-zinc-400";
    case "partial":
      return "text-amber-400";
    case "deploying":
      return "text-amber-400";
    case "not_deployed":
      return "text-zinc-500";
    case "unknown":
      return "text-zinc-500";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function runtimeStatusBadgeColor(status: RuntimeStatus): string {
  switch (status) {
    case "running":
      return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
    case "stopped":
      return "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
    case "partial":
      return "text-amber-400 bg-amber-400/10 border-amber-400/20";
    case "deploying":
      return "text-amber-400 bg-amber-400/10 border-amber-400/20";
    case "not_deployed":
      return "text-zinc-500 bg-zinc-500/10 border-zinc-500/20";
    case "unknown":
      return "text-zinc-500 bg-zinc-500/10 border-zinc-500/20";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
