import type { ReactNode } from "react";
import { toneBadgeClass, type SemanticTone } from "@/lib/ui-status";

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: SemanticTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${toneBadgeClass(tone)} ${className}`}
    >
      {children}
    </span>
  );
}
