import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface PreferencesState {
  themePreference: ThemePreference;
}

interface PreferencesActions {
  setThemePreference: (pref: ThemePreference) => void;
}

type PreferencesStore = PreferencesState & PreferencesActions;

export const STORAGE_KEY = "olive:preferences";

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      themePreference: "system",
      setThemePreference: (pref) => set({ themePreference: pref }),
    }),
    { name: STORAGE_KEY },
  ),
);

/**
 * Resolve the effective theme given a preference and OS signal.
 * Pure function — testable without DOM.
 */
export function resolveTheme(
  preference: ThemePreference,
  osDark: boolean,
): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return osDark ? "dark" : "light";
}
