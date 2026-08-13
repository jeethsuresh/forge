"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyDocumentTheme,
  readThemePreference,
  resolveEffectiveTheme,
  systemPrefersDark,
  writeThemePreference,
  type EffectiveTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  effective: EffectiveTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(true);

  useEffect(() => {
    setPreferenceState(readThemePreference());
    setSystemDark(systemPrefersDark());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const effective = useMemo(
    () => resolveEffectiveTheme(preference, systemDark),
    [preference, systemDark],
  );

  useEffect(() => {
    applyDocumentTheme(effective);
  }, [effective]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemePreference(next);
    applyDocumentTheme(resolveEffectiveTheme(next, systemPrefersDark()));
  }, []);

  const value = useMemo(
    () => ({ preference, effective, setPreference }),
    [preference, effective, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
