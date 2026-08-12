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
    <span className={`${toneBadgeClass(tone)} ${className}`}>{children}</span>
  );
}
