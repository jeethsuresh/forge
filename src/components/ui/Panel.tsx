import type { ReactNode } from "react";

export function Panel({
  className = "",
  elevated = false,
  children,
}: {
  className?: string;
  elevated?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`${elevated ? "forge-surface-elevated" : "forge-surface"} ${className}`}
    >
      {children}
    </div>
  );
}
