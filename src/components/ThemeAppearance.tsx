"use client";

import { useTheme } from "@/components/ThemeProvider";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeAppearance() {
  const { preference, setPreference, effective } = useTheme();

  return (
    <section className="forge-surface mb-8 p-5">
      <h2 className="text-sm font-semibold tracking-tight text-[var(--forge-bright)]">
        Appearance
      </h2>
      <p className="mt-1 text-sm text-[var(--forge-muted)]">
        Dual theme uses the same status colors in light and dark. Effective now:{" "}
        <span className="font-medium text-[var(--forge-bright)]">{effective}</span>.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Theme">
        {OPTIONS.map((option) => {
          const active = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreference(option.value)}
              aria-pressed={active}
              className={`min-h-10 rounded-[10px] border px-4 text-sm font-medium transition-colors ${
                active
                  ? "border-[color-mix(in_srgb,var(--forge-accent)_45%,transparent)] bg-[var(--forge-accent-muted)] text-[var(--forge-bright)]"
                  : "border-[var(--forge-line-strong)] text-[var(--forge-muted)] hover:bg-[var(--forge-wash)] hover:text-[var(--forge-bright)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
