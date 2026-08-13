import type { RuntimeStatus } from "@/lib/project-status";
import { projectModeHref, type ProjectMode } from "@/lib/project-routes";

export type FleetProject = {
  id: string;
  name: string;
  githubRepo?: string;
  branch: string;
  enabled: boolean;
  isDeploying: boolean;
  runtimeStatus: RuntimeStatus;
  isForge?: boolean;
  latestDeployment: { status: string; startedAt?: string } | null;
};

export type AttentionReason =
  | "failed_deploy"
  | "deploying"
  | "partial"
  | "stopped"
  | "paused";

export type AttentionItem = {
  project: FleetProject;
  reason: AttentionReason;
  label: string;
  href: string;
  actionLabel: string;
};

export function attentionModeForReason(reason: AttentionReason): ProjectMode {
  switch (reason) {
    case "failed_deploy":
    case "deploying":
    case "partial":
    case "stopped":
      return "deploy";
    case "paused":
      return "settings";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function attentionActionLabel(reason: AttentionReason): string {
  switch (reason) {
    case "failed_deploy":
      return "Open Deploy";
    case "deploying":
      return "Watch Deploy";
    case "partial":
    case "stopped":
      return "Open Deploy";
    case "paused":
      return "Open Settings";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function attentionForProject(project: FleetProject): AttentionItem | null {
  if (project.latestDeployment?.status === "failed") {
    const reason = "failed_deploy" as const;
    return {
      project,
      reason,
      label: "Latest deploy failed",
      href: projectModeHref(project.id, attentionModeForReason(reason)),
      actionLabel: attentionActionLabel(reason),
    };
  }
  if (project.isDeploying || project.runtimeStatus === "deploying") {
    const reason = "deploying" as const;
    return {
      project,
      reason,
      label: "Deploy in progress",
      href: projectModeHref(project.id, attentionModeForReason(reason)),
      actionLabel: attentionActionLabel(reason),
    };
  }
  if (project.runtimeStatus === "partial") {
    const reason = "partial" as const;
    return {
      project,
      reason,
      label: "Partially running",
      href: projectModeHref(project.id, attentionModeForReason(reason)),
      actionLabel: attentionActionLabel(reason),
    };
  }
  if (
    project.runtimeStatus === "stopped" &&
    project.latestDeployment?.status === "success"
  ) {
    const reason = "stopped" as const;
    return {
      project,
      reason,
      label: "Containers stopped",
      href: projectModeHref(project.id, attentionModeForReason(reason)),
      actionLabel: attentionActionLabel(reason),
    };
  }
  if (!project.enabled && !project.isForge) {
    const reason = "paused" as const;
    return {
      project,
      reason,
      label: "Watching paused",
      href: projectModeHref(project.id, attentionModeForReason(reason)),
      actionLabel: attentionActionLabel(reason),
    };
  }
  return null;
}

export function collectAttention(projects: FleetProject[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const project of projects) {
    const item = attentionForProject(project);
    if (item) items.push(item);
  }
  return items;
}
