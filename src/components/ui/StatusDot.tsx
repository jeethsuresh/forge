import { toneDotClass, type SemanticTone } from "@/lib/ui-status";

export function StatusDot({
  tone = "neutral",
  pulse = false,
  className = "",
  title,
}: {
  tone?: SemanticTone;
  pulse?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${toneDotClass(tone)} ${pulse ? "animate-pulse" : ""} ${className}`}
    />
  );
}
