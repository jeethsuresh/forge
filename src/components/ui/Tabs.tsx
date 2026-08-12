import type { ButtonHTMLAttributes, ReactNode } from "react";

export function TabButton({
  active,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`min-h-10 flex-1 rounded-md px-2 py-2 text-xs font-medium transition-colors sm:text-sm ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabList({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1 ${className}`}
    >
      {children}
    </div>
  );
}
