import type { GpuMetrics } from "../lib/gpuMetrics.ts";

// ─── KB Status ────────────────────────────────────────────────────────────────

export interface KbStatusCache {
  available: boolean;
  version?: string;
  lastUpdated?: string | null;
  lastSync?: string | null;
  passCount?: number;
  error?: string;
}

// ─── AI Provider Config ───────────────────────────────────────────────────────

export interface ProviderConfig {
  provider:
    | "gemini"
    | "openai"
    | "anthropic"
    | "mistral"
    | "openai-compat"
    | "xai"
    | "openrouter"
    | "groq"
    | "together"
    | "chatgpt-sub"
    | "copilot"
    | "devin"
    | "kilocode"
    /** OpenAI Codex via local app-server + SDK (ChatGPT Plus/Pro subscription). */
    | "codex";
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Optional per-provider request timeout (ms). Falls back to the shared default. */
  timeoutMs?: number;
}

export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── AI Provider Response Types ───────────────────────────────────────────────

export interface GeminiRequestBody {
  system_instruction: { parts: [{ text: string }] };
  contents: Array<{ role: string; parts: [{ text: string }] }>;
  generationConfig?: { responseMimeType: string };
}

export interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export interface OpenAIChatRequestBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string };
}

export interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface AnthropicResponse {
  content?: Array<{ text?: string }>;
}

export interface ApiErrorResponse {
  error?: { message?: string };
}

// ─── Olive Recipe Types ───────────────────────────────────────────────────────

export interface OliveRecipe {
  passes?: Record<string, unknown>;
  input_model?: {
    type?: string;
    config?: Record<string, unknown>;
  };
  systems?: {
    local_system?: {
      config?: {
        accelerators?: Array<{ execution_providers?: string[] }>;
      };
      accelerators?: Array<{ execution_providers?: string[] }>;
    };
  };
  [key: string]: unknown;
}

// ─── MCP Tool Response Type ───────────────────────────────────────────────────

export interface McpToolResponse {
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface IncomingChatMessage {
  role?: string;
  content?: string;
}

// ─── Olive Job Registry ───────────────────────────────────────────────────────

export interface OliveJob {
  id: string;
  status: "setting_up" | "running" | "completed" | "failed" | "cancelled";
  exitCode: number | null;
  logs: string[];
  subscribers: Array<(line: string) => void>;
  metricSubscribers: Array<(metrics: GpuMetrics) => void>;
  process: import("child_process").ChildProcess | null;
  latestMetrics: GpuMetrics | null;
  metricsTimer: ReturnType<typeof setInterval> | null;
  sampling: boolean;
  /** Temp recipe file written for this run; reclaimed when the job finishes. */
  tempRecipePath: string | null;
  /** Epoch ms when the job reached a terminal state (for TTL cleanup). */
  finishedAt: number | null;
  /** Listeners fired once when the job reaches a terminal state (SSE close). */
  doneSubscribers: Array<() => void>;
}

// ─── Venv / Config Types ──────────────────────────────────────────────────────

export interface StudioConfig {
  /** Absolute path to a system Python interpreter (optional override). */
  systemPython?: string;
}

// ─── Recipe Dependency Types ──────────────────────────────────────────────────

export interface PkgDef {
  importName: string;
  installArgs: string[];
  label: string;
}

// ─── Local Model Types ────────────────────────────────────────────────────────

export type LocalProgressFn = (evt: {
  type: "step" | "progress" | "log";
  message: string;
  percent?: number;
}) => void;
