interface DeploymentLike {
  id: string;
  logs: string;
  status: string;
}

export function mergePolledProjectDetail<T extends { deployments: DeploymentLike[] }>(
  previous: T | null,
  incoming: T,
): T {
  if (!previous) return incoming;

  const logsById = new Map(
    previous.deployments
      .filter((deployment) => deployment.logs)
      .map((deployment) => [deployment.id, deployment.logs]),
  );

  const deployments = incoming.deployments.map((deployment) => {
    if (deployment.logs) return deployment;
    const cachedLogs = logsById.get(deployment.id);
    return cachedLogs ? { ...deployment, logs: cachedLogs } : deployment;
  });

  return { ...incoming, deployments };
}
