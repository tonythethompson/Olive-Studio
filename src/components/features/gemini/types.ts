export interface Suggestion {
  title: string;
  description: string;
  impact: "High" | "Medium" | "Low";
  type: "warning" | "success" | "suggestion" | "info";
  autofix: { pass: string; value: string };
}

export interface AnalysisResult {
  score: number;
  level: string;
  summary: string;
  suggestions: Suggestion[];
}

export interface ProviderStatus {
  source: "env" | "user" | "none";
  provider?: string;
  model?: string;
  baseUrl?: string | null;
}

/** Which sidebar tab is currently visible. */
export type SidebarTab = "audit" | "chat" | "settings";
