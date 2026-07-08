"use client";

import Link from "next/link";
import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-zinc-900">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800"
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
        <Link href="/projects" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-500/20 text-xs font-bold text-orange-400">
            F
          </span>
          <span className="font-semibold text-zinc-100">{APP_DISPLAY_NAME}</span>
        </Link>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60"
            onClick={closeMenu}
          />
          <Sidebar
            className="relative z-10 h-full w-64 max-w-[85vw] shadow-2xl"
            onNavigate={closeMenu}
          />
        </div>
      )}

      <Sidebar className="hidden h-full md:flex" />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
