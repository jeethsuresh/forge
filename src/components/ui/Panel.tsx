import type { ReactNode } from "react";

export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-forge-panel ${className}`}
    >
      {children}
    </div>
  );
}
