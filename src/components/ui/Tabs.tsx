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
      data-active={active ? "true" : "false"}
      className={`forge-tab ${className}`}
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
  return <div className={`forge-tablist ${className}`}>{children}</div>;
}
