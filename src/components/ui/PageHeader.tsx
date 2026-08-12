import type { ReactNode } from "react";
import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="forge-page-title">{title}</h1>
        {subtitle ? <p className="forge-page-sub">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="forge-section-label mb-3">{children}</div>;
}

export function ActionLink({
  href,
  variant = "secondary",
  children,
  className = "",
}: {
  href: string;
  variant?: "primary" | "secondary" | "info";
  children: ReactNode;
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-[var(--forge-accent)] text-white hover:bg-[var(--forge-accent-hot)] border-transparent"
      : variant === "info"
        ? "border-[color-mix(in_srgb,var(--forge-info)_35%,transparent)] bg-[var(--forge-info-muted)] text-[var(--forge-info)] hover:bg-[color-mix(in_srgb,var(--forge-info)_22%,transparent)]"
        : "border-[var(--forge-line-strong)] bg-[rgba(0,0,0,0.25)] text-[var(--forge-bright)] hover:bg-[var(--forge-hover)]";
  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 items-center justify-center rounded-[9px] border px-3 text-xs font-semibold transition-colors ${styles} ${className}`}
    >
      {children}
    </Link>
  );
}
