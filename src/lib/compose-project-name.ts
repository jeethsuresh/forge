/** Docker Compose project name derived from an Forge project display name. */
export function composeProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (!slug) return "forge-project";
  if (/^[a-z0-9]/.test(slug)) return slug;
  return `p-${slug}`;
}

/** Stable container name for compose project slug + app service (matches export_compose_env). */
export function composeAppContainerName(composeSlug: string): string {
  return `${composeSlug.replace(/-/g, "_")}_app_1`;
}
