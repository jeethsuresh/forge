/** Docker Compose project name derived from a Forge project display name. */
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
