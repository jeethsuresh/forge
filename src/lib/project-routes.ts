export type ProjectMode =
  | "overview"
  | "deploy"
  | "agents"
  | "changes"
  | "settings";

export const PROJECT_MODES: readonly ProjectMode[] = [
  "overview",
  "deploy",
  "agents",
  "changes",
  "settings",
] as const;

export const PROJECT_MODE_LABELS: Record<ProjectMode, string> = {
  overview: "Overview",
  deploy: "Deploy",
  agents: "Agents",
  changes: "Changes",
  settings: "Settings",
};

export function legacyTabToMode(tab: string | null | undefined): ProjectMode {
  switch (tab) {
    case "config":
    case "settings":
      return "settings";
    case "deploy":
      return "deploy";
    case "agents":
      return "agents";
    case "diff":
    case "changes":
      return "changes";
    case "overview":
    case null:
    case undefined:
    case "":
      return "overview";
    default:
      return "overview";
  }
}

export function projectModePath(projectId: string, mode: ProjectMode): string {
  const base = `/projects/${projectId}`;
  switch (mode) {
    case "overview":
      return base;
    case "deploy":
      return `${base}/deploy`;
    case "agents":
      return `${base}/agents`;
    case "changes":
      return `${base}/changes`;
    case "settings":
      return `${base}/settings`;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function projectModeHref(
  projectId: string,
  mode: ProjectMode,
  query?: Record<string, string | null | undefined>,
): string {
  const path = projectModePath(projectId, mode);
  if (!query) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function resolveProjectModeFromPath(
  pathname: string,
): { projectId: string; mode: ProjectMode } | null {
  const match = pathname.match(
    /^\/projects\/([^/]+)(?:\/(deploy|agents|changes|settings))?\/?$/,
  );
  if (!match) return null;
  const projectId = match[1];
  const segment = match[2];
  if (!segment) return { projectId, mode: "overview" };
  return { projectId, mode: segment as ProjectMode };
}

export function isProjectPathActive(
  pathname: string,
  projectId: string,
): boolean {
  return (
    pathname === `/projects/${projectId}` ||
    pathname.startsWith(`/projects/${projectId}/`)
  );
}

/** Map legacy `?tab=` URLs onto intent paths, preserving other query keys. */
export function legacyProjectSearchToPath(
  projectId: string,
  searchParams: URLSearchParams,
): string | null {
  if (!searchParams.has("tab")) return null;
  const tab = searchParams.get("tab");
  const mode = legacyTabToMode(tab);
  const next = new URLSearchParams(searchParams);
  next.delete("tab");
  const qs = next.toString();
  const path = projectModePath(projectId, mode);
  return qs ? `${path}?${qs}` : path;
}
