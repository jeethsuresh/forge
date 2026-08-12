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
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_10px_currentColor] ${toneDotClass(tone)} ${pulse ? "animate-pulse" : ""} ${className}`}
    />
  );
}
