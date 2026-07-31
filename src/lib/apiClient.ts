/**
 * Typed API client for Olive Studio.
 *
 * Provides shared request/response types for all API endpoints
 * and a typed fetch wrapper for the frontend.
 */

// ─── API Base Types ─────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ─── Runtime / Environment ──────────────────────────────────────────────────

export interface RuntimeEnvStatus {
  venvExists: boolean;
  venvPython: string | null;
  venvScripts: string;
  oliveInstalled: boolean;
  oliveVersion: string | null;
  systemPython: string | null;
  configuredPython: string | null;
  venvOnUserPath: boolean;
  platform: string;
  hint: string;
}

export interface PythonPathRequest {
  pythonPath: string;
}

export interface PythonPathResponse {
  ok: boolean;
  error?: string;
}

// ─── AI / Chat ──────────────────────────────────────────────────────────────

export interface AIChatRequest {
  message: string;
  workspaceContext?: string;
  state?: unknown;
  chatHistory?: Array<{ role: string; content: string }>;
}

export interface AIChatResponse {
  reply: string;
  actions?: unknown[];
}

export interface AIAuditResponse {
  issues: unknown[];
  recommendations: unknown[];
}

export interface AIProviderConfigRequest {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AIProviderConfigResponse {
  ok: boolean;
  provider?: string;
  model?: string;
  error?: string;
}

export interface AIModelListResponse {
  models: Array<{ id: string; name?: string }>;
  provider: string;
}

// ─── Olive Execution ────────────────────────────────────────────────────────

export interface OliveRunRequest {
  recipeJson: string;
  cudaVersion?: string;
}

export interface OliveRunResponse {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export interface OliveJobStatus {
  id: string;
  status: "setting_up" | "running" | "completed" | "failed" | "cancelled";
  exitCode: number | null;
  logs: string[];
  latestMetrics?: unknown;
}

// ─── Hardware Probe ─────────────────────────────────────────────────────────

export interface HardwareProbeResponse {
  probedAt: string;
  platform: {
    os: string;
    arch: string;
    cpuModel: string;
    cpuCores: number;
    systemRamGb?: number;
  };
  nvidia?: {
    gpus: Array<{ name: string; vramMb?: number; driver?: string }>;
    cudaVersion?: string;
  };
  detectedProviders: string[];
  recommendedProvider: string;
  notes: string[];
}

// ─── MCP ────────────────────────────────────────────────────────────────────

export interface McpToolRequest {
  toolName: string;
  args: Record<string, unknown>;
}

export interface McpToolResponse {
  result?: unknown;
  error?: string;
}

export interface KbStatusResponse {
  available: boolean;
  version?: string;
  lastUpdated?: string | null;
  lastSync?: string | null;
  passCount?: number;
  error?: string;
}

export interface KbSyncResponse {
  ok: boolean;
  error?: string;
  version?: string;
}

// ─── Recipe Validation ──────────────────────────────────────────────────────

export interface RecipeValidationResponse {
  valid: boolean;
  errors: string[];
}

// ─── GitHub Proxy ───────────────────────────────────────────────────────────

export interface GitHubRawRequest {
  owner?: string;
  repo?: string;
  repoSlug?: string;
  branch?: string;
  path: string;
}

// ─── Local Models (LM Studio / Ollama) ──────────────────────────────────────

export interface LocalModelInfo {
  id: string;
  sizeBytes?: number;
  loaded?: boolean;
}

export interface LocalHealthResponse {
  running: boolean;
  models: LocalModelInfo[];
  loadedModel?: string;
}

export interface LocalPullRequest {
  modelTag: string;
}

export interface LocalLoadRequest {
  modelTag: string;
}

export interface LocalUnloadRequest {
  modelTag: string;
}

// ─── Batch Jobs ─────────────────────────────────────────────────────────────

export interface BatchJobResponse {
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  logs: string[];
}

// ─── Typed Fetch Wrapper ────────────────────────────────────────────────────

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

/**
 * Typed fetch wrapper for Olive Studio API endpoints.
 * Automatically prepends `/api/` and handles JSON serialization/deserialization.
 */
export async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { body, ...rest } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };

  const response = await fetch(`/api${endpoint}`, {
    ...rest,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message =
      (errorBody as { error?: string }).error ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/**
 * SSE stream helper — calls callback with each NDJSON line.
 */
export function streamSSE<T>(
  endpoint: string,
  onLine: (data: T) => void,
  signal?: AbortSignal,
): { close: () => void } {
  const controller = new AbortController();
  const combinedSignal = signal ? anySignal([signal, controller.signal]) : controller.signal;

  fetch(`/api${endpoint}`, { signal: combinedSignal })
    .then(async (response) => {
      if (!response.ok) throw new Error(`SSE stream failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) {
            try {
              onLine(JSON.parse(line) as T);
            } catch {
              /* skip unparseable lines */
            }
          }
        }
      }
    })
    .catch(() => {
      /* stream closed or errored */
    });

  return { close: () => controller.abort() };
}

/** Combine multiple AbortSignals into one. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
