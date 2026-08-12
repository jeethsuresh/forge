import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "warning"
  | "info";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--forge-accent)] text-white hover:bg-[var(--forge-accent-hot)] border border-transparent shadow-[0_0_0_1px_rgba(255,122,26,0.25)]",
  secondary:
    "border border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.25)] text-[var(--forge-bright)] hover:bg-[var(--forge-hover)]",
  danger:
    "border border-[color-mix(in_srgb,var(--forge-danger)_35%,transparent)] bg-[var(--forge-danger-muted)] text-[var(--forge-danger)] hover:bg-[color-mix(in_srgb,var(--forge-danger)_22%,transparent)]",
  warning:
    "border border-[color-mix(in_srgb,var(--forge-warning)_35%,transparent)] bg-[var(--forge-warning-muted)] text-[var(--forge-warning)] hover:bg-[color-mix(in_srgb,var(--forge-warning)_22%,transparent)]",
  info:
    "border border-[color-mix(in_srgb,var(--forge-info)_35%,transparent)] bg-[var(--forge-info-muted)] text-[var(--forge-info)] hover:bg-[color-mix(in_srgb,var(--forge-info)_22%,transparent)]",
  ghost:
    "border border-transparent text-[var(--forge-muted)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--forge-bright)]",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 px-2.5 py-1.5 text-xs rounded-[9px]",
  md: "min-h-11 px-4 py-2.5 text-sm rounded-[10px]",
  lg: "min-h-12 px-5 py-3 text-sm rounded-[12px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}) {
  return (
    <button
      type={type ?? "button"}
      className={`inline-flex items-center justify-center gap-1.5 font-semibold transition-colors disabled:opacity-45 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
