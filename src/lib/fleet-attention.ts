import type { RuntimeStatus } from "@/lib/project-status";

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
};

export function attentionForProject(project: FleetProject): AttentionItem | null {
  if (project.latestDeployment?.status === "failed") {
    return {
      project,
      reason: "failed_deploy",
      label: "Latest deploy failed",
    };
  }
  if (project.isDeploying || project.runtimeStatus === "deploying") {
    return {
      project,
      reason: "deploying",
      label: "Deploy in progress",
    };
  }
  if (project.runtimeStatus === "partial") {
    return {
      project,
      reason: "partial",
      label: "Partially running",
    };
  }
  if (
    project.runtimeStatus === "stopped" &&
    project.latestDeployment?.status === "success"
  ) {
    return {
      project,
      reason: "stopped",
      label: "Containers stopped",
    };
  }
  if (!project.enabled && !project.isForge) {
    return {
      project,
      reason: "paused",
      label: "Watching paused",
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
