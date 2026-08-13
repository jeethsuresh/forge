export type ThemePreference = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "forge-theme";

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): EffectiveTheme {
  switch (preference) {
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "system":
      return systemDark ? "dark" : "light";
    default: {
      const _exhaustive: never = preference;
      return _exhaustive;
    }
  }
}

export function parseThemePreference(raw: string | null): ThemePreference {
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }
  return "system";
}

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // ignore quota / private mode
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyDocumentTheme(theme: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}
