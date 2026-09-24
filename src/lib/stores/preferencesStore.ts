import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SidebarTab } from "@/components/features/assistant/types";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type McpRetrievalMode = "auto" | "keyword" | "semantic";

interface PreferencesState {
  themePreference: ThemePreference;
  /** True once the guided tour has run (finished or skipped). Gates the first-run auto-offer; replay from Settings is always available. */
  tourSeen: boolean;
  mcpRetrievalMode: McpRetrievalMode;
  mcpPreloadEmbeddings: boolean;
  /** Persisted Assistant sidebar open state so it survives page reloads / app restarts. */
  assistantSidebarOpen: boolean;
  /** Persisted active tab in the Assistant sidebar so users return to the panel they left. */
  assistantActiveTab: SidebarTab;
}

interface PreferencesActions {
  setThemePreference: (pref: ThemePreference) => void;
  markTourSeen: () => void;
  setMcpRetrievalMode: (mode: McpRetrievalMode) => void;
  setMcpPreloadEmbeddings: (enabled: boolean) => void;
  setAssistantSidebarOpen: (open: boolean) => void;
  setAssistantActiveTab: (tab: SidebarTab) => void;
}

type PreferencesStore = PreferencesState & PreferencesActions;

export const STORAGE_KEY = "olive:preferences";

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      themePreference: "system",
      tourSeen: false,
      mcpRetrievalMode: "auto",
      mcpPreloadEmbeddings: false,
      assistantSidebarOpen: false,
      assistantActiveTab: "assistant",
      setThemePreference: (pref) => set({ themePreference: pref }),
      markTourSeen: () => set({ tourSeen: true }),
      setMcpRetrievalMode: (mode) => set({ mcpRetrievalMode: mode }),
      setMcpPreloadEmbeddings: (enabled) => set({ mcpPreloadEmbeddings: enabled }),
      setAssistantSidebarOpen: (open) => set({ assistantSidebarOpen: open }),
      setAssistantActiveTab: (tab) => set({ assistantActiveTab: tab }),
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
