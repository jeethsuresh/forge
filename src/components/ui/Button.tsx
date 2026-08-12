import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "warning";
type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-orange-500 text-white hover:bg-orange-400 border border-transparent",
  secondary:
    "border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800",
  danger:
    "border border-red-400/30 bg-red-400/10 text-red-300 hover:bg-red-400/20",
  warning:
    "border border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20",
  ghost: "border border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 px-2.5 py-1.5 text-xs",
  md: "min-h-11 px-4 py-2.5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
