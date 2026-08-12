import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { getComposeContainerStatus, type ContainerInfo } from "@/lib/docker";
import {
  listServiceDirectory,
  markServiceObserved,
} from "@/lib/service-directory";

export type ObserveDeployTargetPortsOpts = {
  projectId: string;
  deployTarget: string;
  composeSlug: string;
  deploymentId: string;
  commitSha: string;
};

/** Extract host ports from compose/docker ps port strings. */
export function parsePublishedHostPorts(portsField: string): number[] {
  const found = new Set<number>();
  const trimmed = portsField.trim();
  if (!trimmed) return [];

  for (const match of trimmed.matchAll(/\b(\d{2,5}):(\d{2,5})\b/g)) {
    found.add(Number(match[1]));
  }

  for (const match of trimmed.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}:(\d{2,5})\b/g)) {
    found.add(Number(match[1]));
  }

  return [...found];
}

function isContainerRunning(container: ContainerInfo): boolean {
  const state = container.state.toLowerCase();
  return state === "running" || state.startsWith("up");
}

export async function observeDeployTargetPorts(
  opts: ObserveDeployTargetPortsOpts,
): Promise<void> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, opts.projectId))
    .get();
  if (!project) return;

  let containers: ContainerInfo[] = [];
  try {
    containers = await getComposeContainerStatus(
      project.clonePath,
      opts.composeSlug,
    );
  } catch {
    containers = [];
  }

  const running = containers.filter(isContainerRunning);
  const published = new Set(
    containers.flatMap((c) => parsePublishedHostPorts(c.ports)),
  );

  const rows = listServiceDirectory({ projectId: opts.projectId }).filter(
    (row) => row.deployTarget === opts.deployTarget,
  );

  for (const row of rows) {
    if (running.length === 0) {
      markServiceObserved({
        projectId: opts.projectId,
        deployTarget: opts.deployTarget,
        portName: row.portName,
        boundPort: null,
        deploymentId: opts.deploymentId,
        commitSha: opts.commitSha,
        status: "down",
      });
      continue;
    }

    if (published.has(row.port)) {
      markServiceObserved({
        projectId: opts.projectId,
        deployTarget: opts.deployTarget,
        portName: row.portName,
        boundPort: row.port,
        deploymentId: opts.deploymentId,
        commitSha: opts.commitSha,
        status: "up",
      });
      continue;
    }

    markServiceObserved({
      projectId: opts.projectId,
      deployTarget: opts.deployTarget,
      portName: row.portName,
      boundPort: null,
      deploymentId: opts.deploymentId,
      commitSha: opts.commitSha,
      status: "down",
    });
  }
}
