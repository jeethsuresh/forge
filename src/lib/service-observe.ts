import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deployTargets, projects } from "@/lib/db/schema";
import { getComposeContainerStatus, type ContainerInfo } from "@/lib/docker";
import {
  isContainerRunningState,
  parsePublishedPortBindings,
  resolveBoundHostPort,
} from "@/lib/container-runtime";
import { projectComposeSlug } from "@/lib/projects";
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

export {
  parsePublishedHostPorts,
  parsePublishedPortBindings,
} from "@/lib/container-runtime";

function isContainerRunning(container: ContainerInfo): boolean {
  return isContainerRunningState(container.state, container.status);
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
  const runtimeUp = running.length > 0;
  const bindings = containers.flatMap((c) =>
    parsePublishedPortBindings(c.ports),
  );

  const rows = listServiceDirectory({ projectId: opts.projectId }).filter(
    (row) => row.deployTarget === opts.deployTarget,
  );

  for (const row of rows) {
    const matchedHost = resolveBoundHostPort(row.port, bindings);
    const boundPort = runtimeUp ? (matchedHost ?? row.port) : null;

    markServiceObserved({
      projectId: opts.projectId,
      deployTarget: opts.deployTarget,
      portName: row.portName,
      boundPort,
      deploymentId: opts.deploymentId,
      commitSha: opts.commitSha,
      status: runtimeUp ? "up" : "down",
    });
  }
}

export async function refreshAllServiceDirectoryRuntime(): Promise<void> {
  const rows = listServiceDirectory();
  const seen = new Set<string>();

  for (const row of rows) {
    const key = `${row.projectId}\0${row.deployTarget}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .get();
    if (!project) continue;

    const target = db
      .select()
      .from(deployTargets)
      .where(
        and(
          eq(deployTargets.projectId, row.projectId),
          eq(deployTargets.name, row.deployTarget),
        ),
      )
      .get();

    const composeSlug =
      target?.composeSlug?.trim() || projectComposeSlug(project);

    await observeDeployTargetPorts({
      projectId: row.projectId,
      deployTarget: row.deployTarget,
      composeSlug,
      deploymentId: row.deploymentId ?? "",
      commitSha: row.commitSha ?? "",
    });
  }
}
