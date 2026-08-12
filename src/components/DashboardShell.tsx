"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { APP_DISPLAY_NAME, appDisplayInitial } from "@/lib/app-name";
import { Sidebar } from "@/components/Sidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { Kbd } from "@/components/ui";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="forge-app-bg flex h-full min-h-0 flex-1 overflow-hidden">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--forge-line)] bg-[color-mix(in_srgb,var(--forge-app)_92%,transparent)] px-4 backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="flex h-10 w-10 items-center justify-center rounded-[10px] text-[var(--forge-muted)] hover:bg-[rgba(255,255,255,0.05)]"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--forge-accent-muted)] text-xs font-bold text-[var(--forge-accent-hot)]">
            {appDisplayInitial()}
          </span>
          <span className="font-semibold tracking-tight text-[var(--forge-bright)]">
            {APP_DISPLAY_NAME}
          </span>
        </Link>
        <button
          type="button"
          className="ml-auto text-[var(--forge-faint)]"
          onClick={() => window.dispatchEvent(new Event("forge:open-palette"))}
        >
          <Kbd>⌘K</Kbd>
        </button>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-[var(--forge-overlay)]"
            onClick={closeMenu}
          />
          <Sidebar
            className="relative z-10 h-full w-64 max-w-[85vw] shadow-2xl"
            onNavigate={closeMenu}
          />
        </div>
      ) : null}

      <Sidebar className="hidden h-full md:flex" />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0">
        {children}
      </main>

      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </div>
  );
}
