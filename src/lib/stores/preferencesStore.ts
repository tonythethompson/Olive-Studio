import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type McpRetrievalMode = "auto" | "keyword" | "semantic";

interface PreferencesState {
  themePreference: ThemePreference;
  welcomeDismissed: boolean;
  /** True once the guided tour has run (finished or skipped). Gates the first-run auto-offer; replay from Settings is always available. */
  tourSeen: boolean;
  mcpRetrievalMode: McpRetrievalMode;
  mcpPreloadEmbeddings: boolean;
}

interface PreferencesActions {
  setThemePreference: (pref: ThemePreference) => void;
  dismissWelcome: () => void;
  markTourSeen: () => void;
  setMcpRetrievalMode: (mode: McpRetrievalMode) => void;
  setMcpPreloadEmbeddings: (enabled: boolean) => void;
}

type PreferencesStore = PreferencesState & PreferencesActions;

export const STORAGE_KEY = "olive:preferences";

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      themePreference: "system",
      welcomeDismissed: false,
      tourSeen: false,
      mcpRetrievalMode: "auto",
      mcpPreloadEmbeddings: false,
      setThemePreference: (pref) => set({ themePreference: pref }),
      dismissWelcome: () => set({ welcomeDismissed: true }),
      markTourSeen: () => set({ tourSeen: true }),
      setMcpRetrievalMode: (mode) => set({ mcpRetrievalMode: mode }),
      setMcpPreloadEmbeddings: (enabled) => set({ mcpPreloadEmbeddings: enabled }),
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
