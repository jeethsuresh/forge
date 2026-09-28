export type PublishedPortBinding = {
  host: number;
  container: number;
};

export function isContainerRunningState(
  state: string,
  status = "",
): boolean {
  const normalizedState = state.toLowerCase().trim();
  if (
    normalizedState === "running" ||
    normalizedState === "up" ||
    normalizedState.startsWith("up")
  ) {
    return true;
  }

  const normalizedStatus = status.toLowerCase().trim();
  return normalizedStatus === "up" || normalizedStatus.startsWith("up ");
}

export function containerRuntimeLabel(
  state: string,
  status = "",
): "Up" | "Down" {
  return isContainerRunningState(state, status) ? "Up" : "Down";
}

export function serviceDirectoryStatusLabel(status: string): string {
  switch (status) {
    case "up":
      return "Up";
    case "down":
      return "Down";
    case "unknown":
      return "Unknown";
    default:
      return status;
  }
}

function pushBinding(
  found: PublishedPortBinding[],
  host: number,
  container: number,
): void {
  if (!Number.isFinite(host) || !Number.isFinite(container)) return;
  if (host < 1 || host > 65535 || container < 1 || container > 65535) return;
  if (found.some((b) => b.host === host && b.container === container)) return;
  found.push({ host, container });
}

/** Parse docker/compose published port strings into host↔container bindings. */
export function parsePublishedPortBindings(
  portsField: string,
): PublishedPortBinding[] {
  const found: PublishedPortBinding[] = [];
  const trimmed = portsField.trim();
  if (!trimmed) return found;

  for (const match of trimmed.matchAll(
    /\b(\d{2,5})->(\d{2,5})\b/g,
  )) {
    pushBinding(found, Number(match[1]), Number(match[2]));
  }

  for (const match of trimmed.matchAll(
    /\b(\d{2,5}):(\d{2,5})\b/g,
  )) {
    pushBinding(found, Number(match[1]), Number(match[2]));
  }

  for (const match of trimmed.matchAll(
    /\b\d{1,3}(?:\.\d{1,3}){3}:(\d{2,5})\b/g,
  )) {
    const host = Number(match[1]);
    if (found.some((b) => b.host === host)) continue;
    pushBinding(found, host, host);
  }

  return found;
}

/** Extract host ports from compose/docker ps port strings. */
export function parsePublishedHostPorts(portsField: string): number[] {
  return [
    ...new Set(parsePublishedPortBindings(portsField).map((b) => b.host)),
  ];
}

export function resolveBoundHostPort(
  declaredPort: number,
  bindings: PublishedPortBinding[],
): number | null {
  const hostMatch = bindings.find((b) => b.host === declaredPort);
  if (hostMatch) return hostMatch.host;
  const containerMatch = bindings.find((b) => b.container === declaredPort);
  if (containerMatch) return containerMatch.host;
  return null;
}
