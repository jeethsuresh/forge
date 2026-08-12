import { projectSwatch } from "@/lib/project-swatch";

export function ProjectSwatch({
  projectId,
  className = "",
}: {
  projectId: string;
  className?: string;
}) {
  const swatch = projectSwatch(projectId);
  return (
    <span
      aria-hidden
      className={`inline-block w-1 shrink-0 self-stretch rounded-full ${className}`}
      style={swatch.stripeStyle}
    />
  );
}
