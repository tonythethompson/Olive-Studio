import { useState, useEffect, useRef, useMemo, useTransition } from "react";
import { UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { cn } from "@/lib/utils";
import {
  buildAiWorkspaceContext,
  buildChatPresetQueries,
  buildWorkspaceContextSummary,
} from "@/lib/aiWorkspaceContext";
import Bot from "lucide-react/dist/esm/icons/bot";
import Send from "lucide-react/dist/esm/icons/send";
import X from "lucide-react/dist/esm/icons/x";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Zap from "lucide-react/dist/esm/icons/zap";
import Check from "lucide-react/dist/esm/icons/check";
import Lightbulb from "lucide-react/dist/esm/icons/lightbulb";
import MessageSquareCode from "lucide-react/dist/esm/icons/message-square-code";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import Key from "lucide-react/dist/esm/icons/key";
import Download from "lucide-react/dist/esm/icons/download";
import { LocalModelManager } from "./LocalModelManager";
import { ProviderErrorBlock } from "./ProviderErrorBlock";
import { AuditPanel } from "./AuditPanel";

interface ProviderOption {
  readonly id: string;
  readonly name: string;
  readonly models: readonly string[];
  readonly keyEnvVar: string;
  readonly docsUrl: string;
  /** Pre-configured base URL for OpenAI-compatible providers. */
  readonly baseUrl?: string;
  /** Category for grouping in the dropdown. */
  readonly category: "direct" | "router" | "subscription" | "custom";
  /** Human-readable description shown below the provider name. */
  readonly description?: string;
}

const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  // ── Direct API Providers ─────────────────────────────────────────────
  {
    id: "gemini",
    name: "Google Gemini",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    keyEnvVar: "GEMINI_API_KEY or GOOGLE_API_KEY",
    docsUrl: "aistudio.google.com",
    category: "direct",
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    keyEnvVar: "OPENAI_API_KEY",
    docsUrl: "platform.openai.com/api-keys",
    category: "direct",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    keyEnvVar: "ANTHROPIC_API_KEY",
    docsUrl: "console.anthropic.com",
    category: "direct",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    models: ["mistral-large-latest", "mistral-medium-latest", "ministral-8b-latest"],
    keyEnvVar: "MISTRAL_API_KEY",
    docsUrl: "console.mistral.ai",
    category: "direct",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    models: ["grok-3", "grok-3-mini", "grok-2"],
    keyEnvVar: "XAI_API_KEY",
    docsUrl: "console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    category: "direct",
    description: "Grok models by xAI",
  },
  // ── API Routers & Aggregators ────────────────────────────────────────
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4-6",
      "google/gemini-2.5-flash",
      "meta-llama/llama-4-scout",
      "deepseek/deepseek-r1",
      "qwen/qwen3-235b-a22b",
    ],
    keyEnvVar: "OPENROUTER_API_KEY",
    docsUrl: "openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    category: "router",
    description: "Access 200+ models via one API key",
  },
  {
    id: "groq",
    name: "Groq",
    models: ["llama-4-scout-17b-16e-instruct", "gemma2-9b-it", "mixtral-8x7b-32768"],
    keyEnvVar: "GROQ_API_KEY",
    docsUrl: "console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    category: "router",
    description: "Ultra-fast inference on Groq LPU",
  },
  {
    id: "together",
    name: "Together AI",
    models: [
      "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen3-235B-A22B-Instruct-2507",
    ],
    keyEnvVar: "TOGETHER_API_KEY",
    docsUrl: "api.together.xyz/settings/api-keys",
    baseUrl: "https://api.together.xyz/v1",
    category: "router",
    description: "Open-source model hosting & inference",
  },
  // ── Subscription / gateway services ─────────────────────────────────
  {
    id: "codex",
    name: "OpenAI Codex",
    models: ["default", "o3", "o4-mini", "gpt-5"],
    keyEnvVar: "",
    docsUrl: "developers.openai.com/codex/auth",
    category: "subscription",
    description: "ChatGPT Plus/Pro Codex allowance — Sign in with ChatGPT (local app-server)",
  },
  {
    id: "chatgpt-sub",
    name: "OpenAI API key",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
    keyEnvVar: "OPENAI_API_KEY",
    docsUrl: "platform.openai.com/api-keys",
    category: "subscription",
    description: "Platform API key (usage-based). Not ChatGPT web login.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "claude-sonnet-4"],
    keyEnvVar: "GITHUB_COPILOT_TOKEN or GITHUB_TOKEN",
    docsUrl: "github.com/settings/copilot",
    baseUrl: "https://api.githubcopilot.com",
    category: "subscription",
    description: "Copilot chat endpoint (session/OAuth token; classic PAT often fails)",
  },
  {
    id: "kilocode",
    name: "Kilo Gateway",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-flash", "deepseek/deepseek-r1"],
    keyEnvVar: "KILO_API_KEY or KILOCODE_API_KEY",
    docsUrl: "kilo.ai/docs/gateway",
    baseUrl: "https://api.kilo.ai/api/gateway",
    category: "subscription",
    description: "Official Kilo AI Gateway (OpenAI-compatible)",
  },
  {
    id: "devin",
    name: "Devin",
    models: ["swe-1-6", "swe-1-7", "claude-sonnet-4", "claude-opus-4", "gpt-4o", "kimi-k2"],
    keyEnvVar: "",
    docsUrl: "devin.ai",
    category: "subscription",
    description: "Devin subscription (not a model) — unlocks multiple models via Sign in with Devin",
  },
  // ── Custom / Self-Hosted ─────────────────────────────────────────────
  {
    id: "openai-compat",
    name: "OpenAI-Compatible",
    models: [],
    keyEnvVar: "",
    docsUrl: "",
    category: "custom",
    description: "Ollama, vLLM, LiteLLM, or any OpenAI-compatible endpoint",
  },
] as const;

type ProviderId = (typeof PROVIDER_OPTIONS)[number]["id"];

/** Category labels for the dropdown optgroup headers. */
const CATEGORY_LABELS: Record<string, string> = {
  direct: "Direct API Providers",
  router: "API Routers & Aggregators",
  subscription: "Subscription Services",
  custom: "Custom / Self-Hosted",
};

/** LM Studio starter models for local AI. */
const LMS_STARTER_MODELS = [
  {
    tag: "qwen2.5-coder-1.5b-instruct",
    name: "Qwen2.5-Coder (1.5B)",
    desc: "⭐ Recommended: Best tool-calling accuracy & Olive recipe precision",
    fallbackSize: "1.1 GB",
  },
  {
    tag: "llama-3.2-1b-instruct",
    name: "Llama-3.2 (1B)",
    desc: "⚡ Ultra-lightweight: Lowest RAM footprint (<1.2GB)",
    fallbackSize: "800 MB",
  },
  {
    tag: "phi-3.5-mini-instruct",
    name: "Phi-3.5-Mini (3.8B)",
    desc: "🧠 Advanced Reasoning: Complex compiler co-design",
    fallbackSize: "2.2 GB",
  },
] as const;

/** Ollama starter models for local AI. */
const OLLAMA_STARTER_MODELS = [
  {
    tag: "qwen2.5-coder:1.5b",
    name: "Qwen2.5-Coder (1.5B)",
    desc: "⭐ Recommended: Best tool-calling accuracy & Olive recipe precision",
    fallbackSize: "1.1 GB",
  },
  {
    tag: "llama3.2:1b",
    name: "Llama-3.2 (1B)",
    desc: "⚡ Ultra-lightweight: Lowest RAM footprint (<1.2GB)",
    fallbackSize: "800 MB",
  },
  {
    tag: "phi3.5",
    name: "Phi-3.5-Mini",
    desc: "🧠 Advanced Reasoning: Complex compiler co-design",
    fallbackSize: "~2 GB",
  },
] as const;

interface GeminiSidebarProps {
  state?: UIState;
  setState?: (partial: Partial<UIState>) => void;
  isOpen: boolean;
  onClose: () => void;
  openToAudit?: boolean;
  onAuditOpened?: () => void;
}

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

interface ProviderStatus {
  source: "env" | "user" | "none";
  provider?: string;
  model?: string;
}

/** Format bytes to human-readable size string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

// ProviderErrorBlock extracted to ./ProviderErrorBlock.tsx
// LocalModelManager extracted to ./LocalModelManager.tsx

export function GeminiSidebar({
  state: propState,
  setState: propSetState,
  isOpen,
  onClose,
  openToAudit,
  onAuditOpened,
}: GeminiSidebarProps) {
  const storeState = usePipelineState();
  const state = propState ?? storeState.state;
  const setState = propSetState ?? storeState.setState;
  const [activeTab, setActiveTab] = useState<"audit" | "chat" | "settings">("audit");
  const [, startTabTransition] = useTransition();

  const handleTabChange = (tab: "audit" | "chat" | "settings") => {
    startTabTransition(() => {
      setActiveTab(tab);
    });
  };

  // Audit
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  // Chat
  const [chatMessages, setChatMessages] = useState<{ sender: "user" | "assistant"; text: string }[]>([
    {
      sender: "assistant",
      text: "Hello! I'm your **Olive Studio assistant**. I read your **live workspace** — model source, hardware target, passes, validation issues, and batch queue — and use that as context for every reply.\n\nUse the quick queries below (they update as you change the pipeline) or ask anything about optimization.",
    },
  ]);
  const [inputQuestion, setInputQuestion] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Provider settings
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({ source: "none" });
  const [settingsProvider, setSettingsProvider] = useState<ProviderId>("gemini");
  const [settingsModel, setSettingsModel] = useState("gemini-2.5-flash");
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [settingsBaseUrl, setSettingsBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [providerSaveError, setProviderSaveError] = useState("");
  const [codexAccount, setCodexAccount] = useState<{
    ready?: boolean;
    account?: { type?: string; email?: string | null; planType?: string } | null;
    error?: string;
  } | null>(null);
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexMessage, setCodexMessage] = useState<string | null>(null);
  const [devinStatus, setDevinStatus] = useState<{
    signedIn?: boolean;
    name?: string;
    error?: string;
  } | null>(null);
  const [devinToken, setDevinToken] = useState("");
  const [devinModels, setDevinModels] = useState<Array<{ id: string; name: string }>>([]);
  const [devinBusy, setDevinBusy] = useState(false);
  const [devinMessage, setDevinMessage] = useState<string | null>(null);
  /** Live model lists keyed by provider — populated automatically on first selection. */
  const [liveModelsByProvider, setLiveModelsByProvider] = useState<
    Record<string, Array<{ id: string; label: string }>>
  >({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSource, setModelsSource] = useState<"live" | "fallback" | null>(null);
  const [modelsHint, setModelsHint] = useState<string | null>(null);
  /** Providers already auto-refreshed this session (skip repeat unless force). */
  const modelsFetchedRef = useRef<Set<string>>(new Set());
  /** Sequence counter to guard against stale responses in refreshProviderModels. */
  const refreshSequenceRef = useRef(0);
  /** Last values used for model fetching to avoid redundant refetches. */
  const lastFetchedApiKeyRef = useRef<string>("");
  const lastFetchedBaseUrlRef = useRef<string>("");
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [localPullError, setLocalPullError] = useState<string>("");
  const [localInstallInfo, setLocalInstallInfo] = useState<string | null>(null);
  /** 0–100 while 1-click pull streams progress; null when idle. */
  const [localPullPercent, setLocalPullPercent] = useState<number | null>(null);
  const [localPullLog, setLocalPullLog] = useState<string[]>([]);
  const [modelSizes, setModelSizes] = useState<Record<string, number>>({});
  const [ollamaHealthy, setOllamaHealthy] = useState<boolean | null>(null);
  const [lmsHealthy, setLmsHealthy] = useState<boolean | null>(null);
  const [lmsInstalled, setLmsInstalled] = useState<boolean | null>(null);
  const [installingEngine, setInstallingEngine] = useState<"lms" | "ollama" | null>(null);
  const [preferredEngine, setPreferredEngine] = useState<"lms" | "ollama">(() => {
    try {
      const stored = localStorage.getItem("localEngine");
      if (stored === "lms" || stored === "ollama") {
        return stored;
      }
      return "lms";
    } catch {
      return "lms";
    }
  });

  const handleSetPreferredEngine = (engine: "lms" | "ollama") => {
    setPreferredEngine(engine);
    setLocalPullError("");
    setLocalInstallInfo(null);
    try {
      localStorage.setItem("localEngine", engine);
    } catch {
      /* ignore */
    }
  };

  // Engine health when sidebar opens (only surface the active tab's status)
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/ai/ollama-health")
      .then((r) => r.json())
      .then((d) => setOllamaHealthy(d.healthy ?? false))
      .catch(() => setOllamaHealthy(false));
    fetch("/api/ai/local-health")
      .then((r) => r.json())
      .then((d: { healthy?: boolean; lmsInstalled?: boolean }) => {
        setLmsHealthy(d.healthy ?? false);
        setLmsInstalled(d.lmsInstalled ?? false);
      })
      .catch(() => {
        setLmsHealthy(false);
        setLmsInstalled(false);
      });
  }, [isOpen, preferredEngine]);

  const handleInstallLocalEngine = async (engine: "lms" | "ollama") => {
    setInstallingEngine(engine);
    setLocalPullError("");
    setLocalPullPercent(0);
    setLocalPullLog([]);
    setLocalInstallInfo(
      engine === "ollama"
        ? "Installing/starting Ollama automatically…"
        : "Installing/starting LM Studio automatically…",
    );
    try {
      const r = await fetch("/api/ai/install-engine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, application/json",
        },
        body: JSON.stringify({ engine }),
      });
      if (!r.body) {
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          message?: string;
          openedUrl?: string;
        };
        if (!r.ok || !data.ok) {
          if (data.openedUrl) window.open(data.openedUrl, "_blank", "noopener,noreferrer");
          throw new Error(data.error || data.message || `HTTP ${r.status}`);
        }
        setLocalInstallInfo(data.message || "Engine ready.");
      } else {
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let ok = false;
        let finalMsg = "Engine ready.";
        let openedUrl: string | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line) as {
                type?: string;
                message?: string;
                percent?: number;
                error?: string;
                openedUrl?: string;
                ok?: boolean;
              };
              if (typeof evt.percent === "number") {
                setLocalPullPercent(Math.max(0, Math.min(100, evt.percent)));
              }
              if (evt.message) {
                setLocalInstallInfo(evt.message);
                setLocalPullLog((prev) => [...prev.slice(-12), evt.message!]);
              }
              if (evt.openedUrl) openedUrl = evt.openedUrl;
              if (evt.type === "error") {
                if (openedUrl || evt.openedUrl) {
                  window.open(openedUrl || evt.openedUrl, "_blank", "noopener,noreferrer");
                }
                throw new Error(evt.error || evt.message || "Setup failed");
              }
              if (evt.type === "done") {
                ok = true;
                finalMsg = evt.message || finalMsg;
                setLocalPullPercent(100);
              }
            } catch (e) {
              if (e instanceof Error && e.message !== "Setup failed" && !e.message.includes("JSON")) {
                throw e;
              }
            }
          }
        }
        if (!ok && !r.ok) throw new Error(`Setup failed (HTTP ${r.status})`);
        setLocalInstallInfo(finalMsg);
      }
      if (engine === "ollama") setOllamaHealthy(true);
      else {
        setLmsHealthy(true);
        setLmsInstalled(true);
      }
    } catch (err: unknown) {
      if (err instanceof TypeError && /fetch/i.test(err.message)) {
        setLocalPullError(
          "Failed to reach Olive Studio server. Keep pnpm dev / tauri:dev running, then retry.",
        );
      } else {
        setLocalPullError(err instanceof Error ? err.message : "Install failed");
      }
      setLocalInstallInfo(null);
    } finally {
      setInstallingEngine(null);
    }
  };

  /**
   * Fetch live model catalog for a provider on first selection (or force re-fetch).
   * Uses env/runtime keys on the server; optional client key/baseUrl for typed-but-unsaved creds.
   * Always falls back to PROVIDER_OPTIONS hardcodes if the live call fails or has no key.
   */
  const refreshProviderModels = async (
    providerId: ProviderId,
    opts?: { force?: boolean; apiKey?: string; baseUrl?: string },
  ) => {
    if (!opts?.force && modelsFetchedRef.current.has(providerId)) {
      return;
    }
    modelsFetchedRef.current.add(providerId);
    refreshSequenceRef.current += 1;
    const currentSequence = refreshSequenceRef.current;
    setModelsLoading(true);
    setModelsHint(null);
    try {
      const body: { provider: string; apiKey?: string; baseUrl?: string } = {
        provider: providerId,
      };
      const key = opts?.apiKey?.trim();
      const base = opts?.baseUrl?.trim();
      if (key) body.apiKey = key;
      if (base) body.baseUrl = base;

      const r = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as {
        models?: Array<{ id: string; label: string }>;
        source?: "live" | "fallback";
        error?: string;
      };

      // Guard against stale responses
      if (currentSequence !== refreshSequenceRef.current) {
        return;
      }

      const models = Array.isArray(data.models) ? data.models : [];
      if (models.length > 0) {
        setLiveModelsByProvider((prev) => ({ ...prev, [providerId]: models }));
        if (providerId === "devin") {
          setDevinModels(models.map((m) => ({ id: m.id, name: m.label })));
        }
        // Keep selection valid when the live list differs from static defaults
        setSettingsModel((current) => {
          if (models.some((m) => m.id === current)) return current;
          return models[0]!.id;
        });
        setCustomModel((current) => {
          if (!current || models.some((m) => m.id === current)) return current || models[0]!.id;
          return models[0]!.id;
        });
      }
      setModelsSource(data.source ?? (models.length > 0 ? "live" : "fallback"));
      if (data.error && data.source === "fallback") {
        setModelsHint(data.error);
      } else if (data.source === "live") {
        setModelsHint(null);
      }
    } catch (err: unknown) {
      // Guard against stale responses
      if (currentSequence !== refreshSequenceRef.current) {
        return;
      }
      setModelsSource("fallback");
      setModelsHint(err instanceof Error ? err.message : "Could not refresh models");
      // Allow retry on next selection if network failed entirely
      modelsFetchedRef.current.delete(providerId);
    } finally {
      // Guard against stale responses
      if (currentSequence === refreshSequenceRef.current) {
        setModelsLoading(false);
      }
    }
  };

  // Refresh Codex / Devin account + auto-load model list when Settings is open
  useEffect(() => {
    if (!isOpen || activeTab !== "settings") return;
    if (settingsProvider === "codex") void refreshCodexAccount();
    if (settingsProvider === "devin") void refreshDevinAccount();
    void refreshProviderModels(settingsProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, settingsProvider]);

  const handlePullLocalModel = async (modelTag: string, source: "lms" | "ollama" = "lms") => {
    setPullingModel(modelTag);
    setLocalPullError("");
    setLocalPullPercent(0);
    setLocalPullLog([]);
    setLocalInstallInfo(
      source === "ollama"
        ? "Starting: ensure Ollama → serve → download…"
        : "Starting: ensure LM Studio → serve → download…",
    );
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-pull" : "/api/ai/local-pull";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000);
      let r: Response;
      try {
        r = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson, application/json",
          },
          body: JSON.stringify({ modelTag }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!r.ok && !r.body) {
        const data = (await r.json().catch(() => ({}))) as { error?: string; hint?: string };
        throw new Error([data.error || `HTTP ${r.status}`, data.hint].filter(Boolean).join(" — "));
      }
      if (!r.body) throw new Error(`Empty response (HTTP ${r.status})`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let gotDone = false;
      let finalMessage = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: {
            type?: string;
            message?: string;
            percent?: number;
            error?: string;
            hint?: string;
            ok?: boolean;
          };
          try {
            evt = JSON.parse(line) as typeof evt;
          } catch {
            continue;
          }
          if (typeof evt.percent === "number" && Number.isFinite(evt.percent)) {
            setLocalPullPercent(Math.max(0, Math.min(100, evt.percent)));
          }
          if (evt.message) {
            setLocalInstallInfo(evt.message);
            if (evt.type === "log" || evt.type === "step" || evt.type === "progress") {
              setLocalPullLog((prev) => [...prev.slice(-12), evt.message!]);
            }
          }
          if (evt.type === "error") {
            throw new Error([evt.error || "Pull failed", evt.hint].filter(Boolean).join(" — "));
          }
          if (evt.type === "done") {
            gotDone = true;
            finalMessage = evt.message || "Model ready.";
            setLocalPullPercent(100);
          }
        }
      }

      // Legacy JSON body (non-stream) if server ever falls back
      if (!gotDone && r.headers.get("content-type")?.includes("application/json") && buf.trim()) {
        const data = JSON.parse(buf) as { ok?: boolean; error?: string; message?: string };
        if (data.error) throw new Error(data.error);
        if (data.ok) {
          gotDone = true;
          finalMessage = data.message || "Model ready.";
        }
      }
      if (!gotDone && !r.ok) {
        throw new Error(`Pull failed (HTTP ${r.status})`);
      }

      setLocalInstallInfo(finalMessage || "Model ready.");
      if (source === "ollama") setOllamaHealthy(true);
      else {
        setLmsHealthy(true);
        setLmsInstalled(true);
      }
      await fetchProviderStatus();
      setAnalysis(null);
      setActiveTab("audit");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setLocalPullError(
          "Download timed out (install + pull can take several minutes). Retry once the engine is installed.",
        );
      } else if (err instanceof TypeError && /fetch/i.test(err.message)) {
        setLocalPullError(
          "Failed to reach Olive Studio server (Failed to fetch). Keep pnpm dev / tauri:dev running, then retry.",
        );
      } else {
        setLocalPullError(err instanceof Error ? err.message : "Failed to pull local model.");
      }
      setLocalInstallInfo(null);
    } finally {
      setPullingModel(null);
      // Keep last percent visible briefly when done; clear on next pull
    }
  };

  const providerOption = PROVIDER_OPTIONS.find((p) => p.id === settingsProvider)!;
  const isCompatMode = settingsProvider === "openai-compat" || !!providerOption.baseUrl;

  /** Models shown in the dropdown: live catalog if loaded, else static PROVIDER_OPTIONS. */
  const displayedModels = useMemo(() => {
    if (settingsProvider === "devin" && devinModels.length > 0) {
      return devinModels.map((m) => ({ id: m.id, label: m.name }));
    }
    const live = liveModelsByProvider[settingsProvider];
    if (live && live.length > 0) return live;
    return providerOption.models.map((m) => ({ id: m, label: m }));
  }, [settingsProvider, devinModels, liveModelsByProvider, providerOption.models]);

  const fetchProviderStatus = async (): Promise<ProviderStatus> => {
    try {
      const r = await fetch("/api/ai/provider");
      const contentType = r.headers.get("content-type") ?? "";
      if (!r.ok || !contentType.includes("application/json")) {
        const fallback: ProviderStatus = { source: "none" };
        setProviderStatus(fallback);
        return fallback;
      }
      const d = (await r.json()) as ProviderStatus;
      setProviderStatus(d);
      if (d.provider && d.provider in Object.fromEntries(PROVIDER_OPTIONS.map((p) => [p.id, true]))) {
        setSettingsProvider(d.provider as ProviderId);
      }
      if (d.model) {
        setSettingsModel(d.model);
        setCustomModel(d.model);
      }
      return d;
    } catch {
      const fallback: ProviderStatus = { source: "none" };
      setProviderStatus(fallback);
      return fallback;
    }
  };

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError("");
    try {
      const r = await fetch("/api/ai/analyze-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await r.json().catch(() => ({})) : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      if (!contentType.includes("application/json")) {
        throw new Error(
          "Server returned non-JSON. Restart with npm run dev (Express + API), not vite alone.",
        );
      }
      setAnalysis(data as AnalysisResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setAnalysisError(err.message || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Effects ──

  // Fetch model sizes from both LM Studio and Ollama on mount
  useEffect(() => {
    Promise.allSettled([
      fetch("/api/ai/local-model-sizes").then((r) => r.json()),
      fetch("/api/ai/ollama-model-sizes").then((r) => r.json()),
    ])
      .then(([lmsRes, ollamaRes]) => {
        const merged: Record<string, number> = {};
        if (lmsRes.status === "fulfilled") {
          const d = lmsRes.value as { sizes?: Record<string, number> };
          if (d.sizes) Object.assign(merged, d.sizes);
        }
        if (ollamaRes.status === "fulfilled") {
          const d = ollamaRes.value as { sizes?: Record<string, number> };
          if (d.sizes) Object.assign(merged, d.sizes);
        }
        setModelSizes(merged);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchProviderStatus().then((status) => {
      if (status.source === "none") setActiveTab("settings");
    });
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !analysis && providerStatus.source !== "none") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: run audit on mount
      handleRunAnalysis();
    }
  }, [isOpen, providerStatus.source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatting]);

  useEffect(() => {
    if (!openToAudit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: respond to prop change
    setActiveTab("audit");
    setAnalysis(null);
    setAnalysisError("");
    handleRunAnalysis();
    onAuditOpened?.();
  }, [openToAudit]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyAutofix = (autofix: Suggestion["autofix"]) => {
    if (!autofix?.pass) return;
    const { pass, value } = autofix;
    // Multi-field JSON patches from the assistant: {"quantMethod":"awq","quantPrecision":"int4"}
    if (value.trim().startsWith("{")) {
      try {
        const obj = JSON.parse(value) as Record<string, unknown>;
        if (pass === "ihvProvider" || pass === "cudaVersion") {
          setState({ [pass]: obj[pass] } as Partial<UIState>);
        } else {
          const passKey = pass.startsWith("passes.") ? pass.slice(7) : pass;
          // If the object has multiple pass keys, merge all; else set single key
          const looksLikePasses = Object.keys(obj).some((k) => k in state.passes || k === passKey);
          if (looksLikePasses && !("ihvProvider" in obj)) {
            setState({
              passes: {
                ...state.passes,
                ...(obj as Partial<UIState["passes"]>),
                // TRT RTX / AWQ suggestions should not leave structured pruning on
                ...(obj.quantMethod === "awq" ? { pruning: false } : {}),
              },
            });
          } else {
            setState(obj as Partial<UIState>);
          }
        }
        setTimeout(() => handleRunAnalysis(), 400);
        return;
      } catch {
        /* fall through to scalar apply */
      }
    }
    if (pass === "ihvProvider") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setState({ ihvProvider: value as any });
    } else if (pass === "cudaVersion") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setState({ cudaVersion: value as any });
    } else {
      const passKey = pass.startsWith("passes.") ? pass.slice(7) : pass;
      const parsed =
        value === "true" ? true : value === "false" ? false : isNaN(Number(value)) ? value : Number(value);
      const nextPasses: UIState["passes"] = {
        ...state.passes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [passKey]: parsed as any,
      };
      // Enabling structured pruning on TensorRT RTX: leave quant as-is; validation will suggest AWQ
      if (passKey === "quantMethod" && value === "awq") {
        nextPasses.pruning = false;
        nextPasses.quantization = true;
      }
      if (passKey === "quantPrecision" && (value === "int4" || value === "int8")) {
        nextPasses.quantization = true;
      }
      setState({ passes: nextPasses });
    }
    setTimeout(() => handleRunAnalysis(), 400);
  };

  const handleSendChat = async (presetText?: string) => {
    const text = presetText || inputQuestion;
    if (!text.trim()) return;
    setChatMessages((prev) => [...prev, { sender: "user", text }]);
    if (!presetText) setInputQuestion("");
    setIsChatting(true);
    setChatError("");
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          workspaceContext,
          chatHistory: chatMessages.map((m) => ({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.text,
          })),
        }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await r.json().catch(() => ({})) : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      if (!contentType.includes("application/json")) {
        throw new Error(
          "Server returned non-JSON. Restart with npm run dev (Express + API), not vite alone.",
        );
      }
      setChatMessages((prev) => [
        ...prev,
        { sender: "assistant", text: (data as { text?: string }).text || "No response generated." },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setChatError(err.message || "Chat request failed.");
    } finally {
      setIsChatting(false);
    }
  };

  const refreshCodexAccount = async () => {
    try {
      const r = await fetch("/api/codex/account");
      const data = (await r.json()) as {
        ok?: boolean;
        ready?: boolean;
        account?: { type?: string; email?: string | null; planType?: string } | null;
        error?: string;
      };
      setCodexAccount(data);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCodexAccount({ ready: false, error: msg });
      return null;
    }
  };

  const handleCodexLogin = async () => {
    setCodexBusy(true);
    setCodexMessage(null);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/codex/login", { method: "POST" });
      const data = (await r.json()) as {
        ok?: boolean;
        authUrl?: string;
        error?: string;
        message?: string;
      };
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (data.authUrl) {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      }
      setCodexMessage(data.message || "Complete sign-in in the browser, then click Refresh status.");
      // Poll account a few times after login window opens
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 2500));
        const acc = await refreshCodexAccount();
        if (acc?.ready) {
          setCodexMessage(
            `Signed in${acc.account && "planType" in (acc.account as object) ? ` (${(acc.account as { planType?: string }).planType})` : ""}. Codex is active for audit/chat.`,
          );
          await fetch("/api/ai/provider", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "codex", model: settingsModel || "default" }),
          });
          await fetchProviderStatus();
          break;
        }
      }
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexBusy(false);
    }
  };

  const handleCodexLogout = async () => {
    setCodexBusy(true);
    setCodexMessage(null);
    try {
      await fetch("/api/codex/logout", { method: "POST" });
      await refreshCodexAccount();
      setCodexMessage("Signed out of Codex.");
      await fetchProviderStatus();
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexBusy(false);
    }
  };

  const refreshDevinAccount = async () => {
    try {
      const r = await fetch("/api/devin/account");
      const data = (await r.json()) as { signedIn?: boolean; name?: string; error?: string };
      setDevinStatus(data);
      if (data.signedIn) {
        // Prefer unified catalog (also fills liveModelsByProvider)
        await refreshProviderModels("devin", { force: true });
      }
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDevinStatus({ signedIn: false, error: msg });
      return null;
    }
  };

  const handleDevinOpenSignIn = async () => {
    setDevinBusy(true);
    setDevinMessage(null);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/devin/login");
      const data = (await r.json()) as { ok?: boolean; authUrl?: string; error?: string };
      if (!r.ok || !data.ok || !data.authUrl) throw new Error(data.error || `HTTP ${r.status}`);
      window.open(data.authUrl, "_blank", "noopener,noreferrer");
      setDevinMessage("Sign in in the browser, then paste the token shown on the page below.");
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDevinBusy(false);
    }
  };

  const handleDevinCompleteLogin = async () => {
    setDevinBusy(true);
    setDevinMessage(null);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/devin/login/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: devinToken }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; name?: string; message?: string };
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setDevinToken("");
      setDevinMessage(data.message || `Signed in as ${data.name ?? "Devin"}.`);
      await refreshDevinAccount();
      await fetch("/api/ai/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "devin", model: settingsModel || "swe-1-6" }),
      });
      await fetchProviderStatus();
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDevinBusy(false);
    }
  };

  const handleDevinLogout = async () => {
    setDevinBusy(true);
    try {
      await fetch("/api/devin/logout", { method: "POST" });
      setDevinStatus({ signedIn: false });
      setDevinMessage("Signed out of Devin.");
      await fetchProviderStatus();
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setDevinBusy(false);
    }
  };

  const handleSaveProvider = async () => {
    if (settingsProvider === "codex") {
      // Codex uses browser ChatGPT login, not an API key field
      await handleCodexLogin();
      return;
    }
    if (settingsProvider === "devin") {
      if (!devinStatus?.signedIn) {
        setProviderSaveError("Sign in to Devin and paste the browser token first.");
        return;
      }
      setIsSavingProvider(true);
      setProviderSaveError("");
      try {
        const r = await fetch("/api/ai/provider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "devin", model: settingsModel || "swe-1-6" }),
        });
        const data = (await r.json()) as { error?: string };
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        await fetchProviderStatus();
        setAnalysis(null);
        setActiveTab("audit");
      } catch (err: unknown) {
        setProviderSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSavingProvider(false);
      }
      return;
    }
    const key = settingsApiKey.trim();
    const model = isCompatMode ? customModel.trim() : settingsModel;
    if (!key) {
      setProviderSaveError("Enter an API key.");
      return;
    }
    if (!model || model === "n/a") {
      setProviderSaveError(isCompatMode ? "Enter a model name." : "Select a model.");
      return;
    }
    if (isCompatMode && !settingsBaseUrl.trim() && !providerOption.baseUrl) {
      setProviderSaveError("Base URL is required for OpenAI-compatible providers.");
      return;
    }
    setIsSavingProvider(true);
    setProviderSaveError("");
    try {
      const r = await fetch("/api/ai/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settingsProvider,
          apiKey: key,
          model,
          baseUrl: settingsBaseUrl.trim() || providerOption.baseUrl || undefined,
        }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await r.json().catch(() => ({})) : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      await fetchProviderStatus();
      setSettingsApiKey("");
      setAnalysis(null);
      setActiveTab("audit");
    } catch (err: unknown) {
      setProviderSaveError(err instanceof Error ? err.message : "Failed to save provider.");
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleClearProvider = async () => {
    await fetch("/api/ai/provider", { method: "DELETE" });
    await fetchProviderStatus();
    setAnalysis(null);
  };

  const renderMessageContent = (text: string) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const lines = part.split("\n");
        return (
          <pre
            key={i}
            className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[10px] font-mono text-emerald-400 my-1.5 overflow-x-auto whitespace-pre-wrap"
          >
            {lines.slice(1, -1).join("\n")}
          </pre>
        );
      }
      return part.split("\n").map((line, j) => {
        const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ");
        const clean = isBullet ? line.trim().substring(2) : line;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const elems: any[] = [];
        clean.split(/(\*\*.*?\*\*|`.*?`)/g).forEach((bp, k) => {
          if (bp.startsWith("**") && bp.endsWith("**"))
            elems.push(
              <strong key={k} className="font-bold text-slate-100">
                {bp.slice(2, -2)}
              </strong>,
            );
          else if (bp.startsWith("`") && bp.endsWith("`"))
            elems.push(
              <code
                key={k}
                className="bg-slate-950 border border-slate-800 px-1 py-0.5 rounded text-[10px] font-mono text-cyan-400"
              >
                {bp.slice(1, -1)}
              </code>,
            );
          else elems.push(bp);
        });
        if (isBullet)
          return (
            <li key={`${i}-${j}`} className="ml-3.5 list-disc text-xs text-slate-300 leading-relaxed my-0.5">
              {elems}
            </li>
          );
        if (line.trim().startsWith("### "))
          return (
            <h5 key={`${i}-${j}`} className="text-xs font-semibold text-electric-blue mt-2.5 mb-1">
              {line.trim().substring(4)}
            </h5>
          );
        if (line.trim().startsWith("## "))
          return (
            <h4
              key={`${i}-${j}`}
              className="text-xs font-bold text-slate-100 mt-3 mb-1.5 pb-0.5 border-b border-slate-800/80"
            >
              {line.trim().substring(3)}
            </h4>
          );
        return (
          <p key={`${i}-${j}`} className="text-xs text-slate-300 leading-relaxed my-0.5">
            {elems}
          </p>
        );
      });
    });
  };

  const workspaceContext = useMemo(() => buildAiWorkspaceContext(state), [state]); // eslint-disable-line react-hooks/preserve-manual-memoization
  const presetQueries = useMemo(() => buildChatPresetQueries(state), [state]);
  const workspaceSummary = useMemo(() => buildWorkspaceContextSummary(workspaceContext), [workspaceContext]); // eslint-disable-line react-hooks/preserve-manual-memoization

  const providerLabel =
    providerStatus.source !== "none"
      ? `${PROVIDER_OPTIONS.find((p) => p.id === providerStatus.provider)?.name ?? providerStatus.provider} / ${providerStatus.model}`
      : "No provider set";

  return (
    <div
      className={cn(
        "h-full shrink-0 overflow-hidden border-l border-slate-800 bg-slate-900 transition-[width] duration-300 ease-in-out",
        isOpen ? "w-[420px]" : "w-0 border-l-0",
      )}
      aria-hidden={!isOpen}
    >
      <div className="w-[420px] h-full flex flex-col shadow-[-4px_0_24px_rgba(3,7,18,0.25)]">
        {/* Header */}
        <div className="h-12 flex items-center justify-between px-5 border-b border-slate-800 shrink-0 bg-slate-950/80">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="h-4 w-4 text-electric-blue shrink-0" />
            <span className="text-sm font-medium text-slate-100">Assistant</span>
            <span className="text-[11px] text-slate-500 truncate hidden sm:inline">· {providerLabel}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg hover:bg-slate-800 border border-slate-800/55 flex items-center justify-center text-slate-400 hover:text-slate-100 transition-colors cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="p-4 border-b border-slate-800/60 bg-slate-950/20 shrink-0">
          <div className="grid grid-cols-3 bg-slate-950/90 p-1 border border-slate-850 rounded-lg transform-gpu">
            {[
              { id: "audit" as const, label: "Audit", Icon: Lightbulb },
              { id: "chat" as const, label: "Chat", Icon: MessageSquareCode },
              { id: "settings" as const, label: "Settings", Icon: Settings2 },
            ].map(({ id, label, Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() => handleTabChange(id)}
                className={`py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer border ${activeTab === id ? "bg-slate-900 text-electric-blue shadow-sm border-slate-800/40" : "text-slate-400 hover:text-slate-200 border-transparent"}`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${activeTab === id ? "text-electric-blue" : "text-slate-500"}`}
                />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative transform-gpu">
          {/* ── Audit ── */}
          <div
            className={cn("absolute inset-0 p-4 overflow-y-auto", activeTab === "audit" ? "block" : "hidden")}
          >
            <AuditPanel
              analysis={analysis}
              isAnalyzing={isAnalyzing}
              analysisError={analysisError}
              onApplyAutofix={handleApplyAutofix}
              onRunAnalysis={handleRunAnalysis}
              onGoSettings={() => setActiveTab("settings")}
            />
          </div>

          {/* ── Chat ── */}
          <div
            className={cn("absolute inset-0 p-4 overflow-y-auto", activeTab === "chat" ? "block" : "hidden")}
          >
            <div className="flex flex-col h-full space-y-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <p className="text-xs text-slate-500 mb-1">Live workspace</p>
                <p className="text-[11px] text-slate-300 leading-relaxed font-mono" title={workspaceSummary}>
                  {workspaceSummary}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-slate-950/50 border border-slate-850 rounded-xl min-h-[350px]">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`max-w-[90%] p-3 rounded-lg text-xs flex flex-col gap-1 ${msg.sender === "user" ? "bg-electric-blue/10 border border-electric-blue/20 ml-auto" : "bg-slate-900 border border-slate-800 mr-auto"}`}
                  >
                    <span className="text-[10px] text-slate-500 mb-0.5 pb-0.5 border-b border-slate-800/40">
                      {msg.sender === "user" ? "You" : "Assistant"}
                    </span>
                    <div>{renderMessageContent(msg.text)}</div>
                  </div>
                ))}
                {isChatting && (
                  <div className="p-3 bg-slate-900/60 border border-slate-850 rounded-lg flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 text-electric-blue animate-spin" />
                    <span className="text-xs text-slate-400">Thinking…</span>
                  </div>
                )}
                {chatError && (
                  <ProviderErrorBlock msg={chatError} onGoSettings={() => setActiveTab("settings")} />
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="space-y-1.5 py-1">
                <span className="text-xs text-slate-500 block">Quick queries</span>
                <div className="flex flex-wrap gap-1.5">
                  {presetQueries.map((prompt, i) => (
                    <button
                      type="button"
                      key={`${i}-${prompt.slice(0, 24)}`}
                      onClick={() => handleSendChat(prompt)}
                      disabled={isChatting}
                      title={prompt}
                      className="text-[10px] px-2.5 py-0.5 bg-slate-950/80 hover:bg-slate-900 text-slate-400 hover:text-slate-100 border border-slate-800 rounded transition-all cursor-pointer text-left max-w-full truncate"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendChat();
                }}
                className="flex gap-2 pt-1.5 border-t border-slate-800/60"
              >
                <input
                  placeholder="Ask about optimization, passes, hardware..."
                  value={inputQuestion}
                  onChange={(e) => setInputQuestion(e.target.value)}
                  disabled={isChatting}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-800 hover:border-slate-700/80 focus:border-electric-blue/40 text-xs px-3 py-2 rounded-lg text-slate-200 focus:outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={isChatting || !inputQuestion.trim()}
                  className="h-9 w-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg flex items-center justify-center shrink-0 text-white cursor-pointer"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>

          {/* ── Settings ── */}
          <div
            className={cn(
              "absolute inset-0 p-4 overflow-y-auto",
              activeTab === "settings" ? "block" : "hidden",
            )}
          >
            <div className="space-y-5">
              {/* Active provider status */}
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold mb-2">
                  Active Provider
                </p>
                {providerStatus.source === "none" ? (
                  <p className="text-xs text-slate-500 italic">No provider. AI features disabled.</p>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">
                        {PROVIDER_OPTIONS.find((p) => p.id === providerStatus.provider)?.name ??
                          providerStatus.provider}
                      </p>
                      <p className="text-[10px] font-mono text-slate-400">
                        {providerStatus.model} · {providerStatus.source === "env" ? "env var" : "session key"}
                      </p>
                    </div>
                    {providerStatus.source === "user" && (
                      <button
                        type="button"
                        onClick={handleClearProvider}
                        className="text-[10px] text-rose-400 hover:text-rose-200 border border-rose-500/20 rounded px-2 py-1 font-bold transition-all cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 1-Click Local Model Setup */}
              <div className="p-3.5 rounded-xl border border-electric-blue/20 bg-electric-blue/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs text-electric-blue">
                    <Download className="h-4 w-4" />
                    <span>1-Click Local AI Setup</span>
                  </div>
                  <span className="text-[10px] bg-electric-blue/10 text-electric-blue border border-electric-blue/30 px-1.5 py-0.5 rounded font-mono">
                    Local & Private
                  </span>
                </div>
                {/* Engine toggle */}
                <div className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleSetPreferredEngine("lms")}
                    className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      preferredEngine === "lms"
                        ? "bg-electric-blue/20 text-electric-blue border border-electric-blue/30"
                        : "text-slate-500 hover:text-slate-300 border border-transparent"
                    }`}
                  >
                    LM Studio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPreferredEngine("ollama")}
                    className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      preferredEngine === "ollama"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-slate-500 hover:text-slate-300 border border-transparent"
                    }`}
                  >
                    Ollama
                  </button>
                </div>
                {(() => {
                  const isLms = preferredEngine === "lms";
                  const accentText = isLms ? "text-electric-blue" : "text-emerald-400";
                  const accentBg = isLms
                    ? "bg-electric-blue/10 hover:bg-electric-blue/20 border-electric-blue/30 text-electric-blue"
                    : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400";
                  const healthy = isLms ? lmsHealthy : ollamaHealthy;
                  const missing = isLms ? lmsInstalled === false : ollamaHealthy === false;
                  const models = isLms ? LMS_STARTER_MODELS : OLLAMA_STARTER_MODELS;
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          Download &amp; enable a local model via{" "}
                          {isLms ? "LM Studio (Llmster CLI)" : "Ollama"} for offline Olive Studio AI — zero
                          cloud keys.
                        </p>
                        <span
                          className={`inline-block w-2 h-2 shrink-0 rounded-full ${
                            healthy === true
                              ? "bg-emerald-400"
                              : healthy === false
                                ? "bg-rose-400"
                                : "bg-slate-500"
                          }`}
                          title={
                            healthy === true
                              ? `${isLms ? "LM Studio" : "Ollama"} ready`
                              : healthy === false
                                ? `${isLms ? "LM Studio" : "Ollama"} not reachable`
                                : "Checking…"
                          }
                        />
                      </div>

                      {missing && (
                        <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 p-2.5 space-y-2">
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            {isLms
                              ? "LM Studio is not running yet. Use 1-Click Download on a model — Olive Studio will install LM Studio (if needed), start the local server, and pull the model."
                              : "Ollama is not running yet. Use 1-Click Download on a model — Olive Studio will install Ollama (if needed), start `ollama serve`, and pull the model."}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={installingEngine !== null}
                              onClick={() => void handleInstallLocalEngine(isLms ? "lms" : "ollama")}
                              className={`h-7 px-2.5 rounded text-[11px] font-bold border flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${accentBg}`}
                            >
                              {installingEngine === preferredEngine ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              Setup {isLms ? "LM Studio" : "Ollama"} now
                            </button>
                            <a
                              href={isLms ? "https://lmstudio.ai" : "https://ollama.com"}
                              target="_blank"
                              rel="noreferrer"
                              className={`text-[11px] underline ${accentText}`}
                            >
                              Manual install
                            </a>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        {models.map((m) => {
                          const sizeBytes = Object.entries(modelSizes).find(([key]) => {
                            const k = key.toLowerCase();
                            const t = m.tag.toLowerCase();
                            return (
                              k === t ||
                              k.includes(t.split(":")[0] ?? "") ||
                              t.includes(k.split("/").pop() ?? "___")
                            );
                          })?.[1];
                          const displaySize = sizeBytes ? formatBytes(sizeBytes) : m.fallbackSize;
                          return (
                            <div
                              key={m.tag}
                              className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/60 flex flex-col gap-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-xs text-slate-100">{m.name}</span>
                                <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
                                  {displaySize}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 leading-normal">{m.desc}</p>
                              <button
                                type="button"
                                onClick={() => handlePullLocalModel(m.tag, isLms ? "lms" : "ollama")}
                                disabled={pullingModel === m.tag}
                                className={`mt-1 w-full h-7 border rounded text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${accentBg}`}
                              >
                                {pullingModel === m.tag ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    <span>Pulling & Activating...</span>
                                  </>
                                ) : (
                                  <>
                                    <Download className="h-3 w-3" />
                                    <span>1-Click Download & Enable</span>
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {(pullingModel || localInstallInfo || localPullPercent !== null) && (
                        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-slate-200 leading-snug flex items-center gap-1.5 min-w-0">
                              {pullingModel ? (
                                <RefreshCw className="h-3 w-3 animate-spin shrink-0 text-electric-blue" />
                              ) : null}
                              <span className="truncate">
                                {localInstallInfo || (pullingModel ? `Working on ${pullingModel}…` : "Ready")}
                              </span>
                            </p>
                            {localPullPercent !== null && (
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                {Math.round(localPullPercent)}%
                              </span>
                            )}
                          </div>
                          {localPullPercent !== null && (
                            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-electric-blue transition-[width] duration-300 ease-out"
                                style={{ width: `${Math.max(2, Math.min(100, localPullPercent))}%` }}
                              />
                            </div>
                          )}
                          {localPullLog.length > 0 && (
                            <div className="max-h-24 overflow-y-auto rounded border border-slate-800/80 bg-black/30 px-2 py-1.5 font-mono text-[10px] text-slate-500 space-y-0.5">
                              {localPullLog.map((line, i) => (
                                <div key={`${i}-${line.slice(0, 24)}`} className="truncate">
                                  {line}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {localPullError && (
                        <p className="text-xs text-rose-400 mt-1 leading-relaxed">{localPullError}</p>
                      )}
                      <LocalModelManager
                        activeModel={providerStatus.model}
                        isOpen={isOpen}
                        engine={preferredEngine}
                      />
                    </>
                  );
                })()}
              </div>

              {/* Configure new provider */}
              <div className="space-y-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold">
                  Manual Provider Setup
                </p>

                <div>
                  <label htmlFor="gemini-settings-provider" className="text-xs text-slate-400 mb-1 block">
                    Provider
                  </label>
                  <select
                    id="gemini-settings-provider"
                    aria-label="AI provider"
                    value={settingsProvider}
                    onChange={(e) => {
                      const id = e.target.value as ProviderId;
                      setSettingsProvider(id);
                      const opt = PROVIDER_OPTIONS.find((p) => p.id === id)!;
                      // Prefer cached live list; otherwise static default until fetch returns
                      const cached = liveModelsByProvider[id];
                      const first = cached?.[0]?.id ?? opt.models[0] ?? "";
                      setSettingsModel(first);
                      setCustomModel(id === "openai-compat" ? "" : first);
                      setSettingsBaseUrl(opt.baseUrl ?? "");
                      setModelsHint(null);
                      // Always refresh model catalog on selection (first time auto; force if re-pick)
                      void refreshProviderModels(id, { force: true });
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
                  >
                    {PROVIDER_OPTIONS.reduce<React.ReactNode[]>((acc, p, i) => {
                      const prev = i > 0 ? PROVIDER_OPTIONS[i - 1] : null;
                      if (!prev || prev.category !== p.category) {
                        acc.push(
                          <option
                            key={`cat-${p.category}`}
                            value=""
                            disabled
                            className="text-slate-500 font-bold"
                          >
                            ── {CATEGORY_LABELS[p.category] ?? p.category} ──
                          </option>,
                        );
                      }
                      acc.push(
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.description ? ` — ${p.description}` : ""}
                        </option>,
                      );
                      return acc;
                    }, [])}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor="gemini-settings-model" className="text-xs text-slate-400 block">
                      Model
                    </label>
                    <div className="flex items-center gap-2">
                      {modelsLoading ? (
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                          Refreshing…
                        </span>
                      ) : modelsSource === "live" ? (
                        <span className="text-[10px] text-emerald-500/80">Live catalog</span>
                      ) : modelsSource === "fallback" ? (
                        <span className="text-[10px] text-slate-500">Defaults</span>
                      ) : null}
                      <button
                        type="button"
                        title="Refresh model list from provider"
                        disabled={modelsLoading}
                        onClick={() =>
                          void refreshProviderModels(settingsProvider, {
                            force: true,
                            apiKey: settingsApiKey || undefined,
                            baseUrl: settingsBaseUrl || providerOption.baseUrl || undefined,
                          })
                        }
                        className="text-[10px] text-slate-400 hover:text-electric-blue disabled:opacity-40 flex items-center gap-0.5"
                      >
                        <RefreshCw className={cn("h-2.5 w-2.5", modelsLoading && "animate-spin")} />
                        Refresh
                      </button>
                    </div>
                  </div>
                  {isCompatMode && settingsProvider === "openai-compat" ? (
                    <input
                      placeholder="Model name (e.g. llama3.1:8b, deepseek-r1)"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                    />
                  ) : isCompatMode && displayedModels.length > 0 ? (
                    // OpenAI-compat routers (xAI, OpenRouter, …): show live list + allow free text
                    <div className="space-y-1.5">
                      <select
                        id="gemini-settings-model"
                        aria-label="AI model"
                        value={
                          displayedModels.some((m) => m.id === (customModel || settingsModel))
                            ? customModel || settingsModel
                            : ""
                        }
                        onChange={(e) => {
                          setSettingsModel(e.target.value);
                          setCustomModel(e.target.value);
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
                      >
                        {!displayedModels.some((m) => m.id === (customModel || settingsModel)) && (
                          <option value="">Select a model…</option>
                        )}
                        {displayedModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="Or type a model id…"
                        value={customModel}
                        onChange={(e) => {
                          setCustomModel(e.target.value);
                          setSettingsModel(e.target.value);
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                      />
                    </div>
                  ) : (
                    <select
                      id="gemini-settings-model"
                      aria-label="AI model"
                      value={settingsModel}
                      onChange={(e) => setSettingsModel(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
                    >
                      {displayedModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {modelsHint && <p className="mt-1 text-[10px] text-slate-500 leading-snug">{modelsHint}</p>}
                </div>

                {settingsProvider === "codex" ? (
                  <div className="space-y-3 p-3 rounded-xl border border-slate-800 bg-slate-950/50">
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Uses local <code className="text-slate-400 font-mono">codex app-server</code> for
                      ChatGPT sign-in and <code className="text-slate-400 font-mono">@openai/codex-sdk</code>{" "}
                      for recipe Q&amp;A (read-only sandbox). Requires the Codex CLI on PATH.
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Status:{" "}
                      {codexAccount?.ready ? (
                        <span className="text-emerald-400">signed in</span>
                      ) : codexAccount?.error ? (
                        <span className="text-rose-400">{codexAccount.error}</span>
                      ) : (
                        <span className="text-slate-500">not signed in</span>
                      )}
                    </p>
                    {codexMessage && <p className="text-[11px] text-emerald-400/90">{codexMessage}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={codexBusy}
                        onClick={() => void handleCodexLogin()}
                        className="flex-1 min-w-[8rem] h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2"
                      >
                        {codexBusy ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Sign in with ChatGPT
                      </button>
                      <button
                        type="button"
                        disabled={codexBusy}
                        onClick={() => void refreshCodexAccount()}
                        className="h-9 px-3 border border-slate-700 rounded-lg text-xs text-slate-300"
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        disabled={codexBusy}
                        onClick={() => void handleCodexLogout()}
                        className="h-9 px-3 border border-rose-500/30 rounded-lg text-xs text-rose-400"
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                ) : settingsProvider === "devin" ? (
                  <div className="space-y-3 p-3 rounded-xl border border-slate-800 bg-slate-950/50">
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      <strong className="text-slate-200">Devin is not a model</strong> — it is a subscription
                      that unlocks multiple models for Assistant audit/chat. Sign in with your Devin account,
                      paste the browser token, then pick a model from your plan.
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Status:{" "}
                      {devinStatus?.signedIn ? (
                        <span className="text-emerald-400">
                          signed in{devinStatus.name ? ` · ${devinStatus.name}` : ""}
                        </span>
                      ) : devinStatus?.error ? (
                        <span className="text-rose-400">{devinStatus.error}</span>
                      ) : (
                        <span className="text-slate-500">not signed in</span>
                      )}
                    </p>
                    {devinMessage && <p className="text-[11px] text-emerald-400/90">{devinMessage}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={devinBusy}
                        onClick={() => void handleDevinOpenSignIn()}
                        className="flex-1 min-w-[8rem] h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2"
                      >
                        {devinBusy ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Open Devin sign-in
                      </button>
                      <button
                        type="button"
                        disabled={devinBusy}
                        onClick={() => void refreshDevinAccount()}
                        className="h-9 px-3 border border-slate-700 rounded-lg text-xs text-slate-300"
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        disabled={devinBusy}
                        onClick={() => void handleDevinLogout()}
                        className="h-9 px-3 border border-rose-500/30 rounded-lg text-xs text-rose-400"
                      >
                        Logout
                      </button>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">
                        Paste token from sign-in page
                      </label>
                      <input
                        type="password"
                        autoComplete="off"
                        value={devinToken}
                        onChange={(e) => setDevinToken(e.target.value)}
                        placeholder="Token shown after browser sign-in"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                      />
                      <button
                        type="button"
                        disabled={devinBusy || !devinToken.trim()}
                        onClick={() => void handleDevinCompleteLogin()}
                        className="mt-2 w-full h-9 border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10 disabled:opacity-40 rounded-lg text-xs font-bold"
                      >
                        Complete sign-in
                      </button>
                    </div>
                    {devinStatus?.signedIn && (
                      <button
                        type="button"
                        disabled={isSavingProvider}
                        onClick={() => void handleSaveProvider()}
                        className="w-full h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2"
                      >
                        {isSavingProvider ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Activate Devin for audit/chat
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {isCompatMode && (
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Base URL</label>
                        <input
                          type="text"
                          placeholder="http://localhost:11434/v1"
                          value={settingsBaseUrl}
                          onChange={(e) => setSettingsBaseUrl(e.target.value)}
                          onBlur={() => {
                            const trimmedUrl = settingsBaseUrl.trim();
                            if (trimmedUrl && trimmedUrl !== lastFetchedBaseUrlRef.current) {
                              lastFetchedBaseUrlRef.current = trimmedUrl;
                              void refreshProviderModels(settingsProvider, {
                                force: true,
                                apiKey: settingsApiKey || undefined,
                                baseUrl: trimmedUrl,
                              });
                            }
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                        />
                        <p className="text-[10px] text-slate-600 mt-1">
                          Works with LM Studio, vLLM, Ollama, etc.
                        </p>
                      </div>
                    )}

                    <div>
                      <label className="text-xs text-slate-400 mb-1 flex items-center gap-1.5 block">
                        <Key className="h-3 w-3" />
                        API Key
                        {"keyEnvVar" in providerOption && providerOption.keyEnvVar && (
                          <span className="text-[9px] text-slate-600">
                            (or env: <code className="font-mono">{providerOption.keyEnvVar}</code>)
                          </span>
                        )}
                      </label>
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder="Stored in memory only, never persisted to disk"
                        value={settingsApiKey}
                        onChange={(e) => setSettingsApiKey(e.target.value)}
                        onBlur={() => {
                          // Re-list models with the key the user just typed (env may already work)
                          const trimmedKey = settingsApiKey.trim();
                          if (trimmedKey && trimmedKey !== lastFetchedApiKeyRef.current) {
                            lastFetchedApiKeyRef.current = trimmedKey;
                            void refreshProviderModels(settingsProvider, {
                              force: true,
                              apiKey: trimmedKey,
                              baseUrl: settingsBaseUrl || providerOption.baseUrl || undefined,
                            });
                          }
                        }}
                        onKeyDown={(e) => e.key === "Enter" && void handleSaveProvider()}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleSaveProvider()}
                      disabled={isSavingProvider}
                      className="w-full h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      {isSavingProvider ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Save & Activate
                    </button>
                  </>
                )}

                {providerSaveError && <p className="text-xs text-rose-400">{providerSaveError}</p>}

                {"docsUrl" in providerOption && providerOption.docsUrl && (
                  <p className="text-[10px] text-slate-600 text-center">
                    Docs: <span className="font-mono text-slate-500">{providerOption.docsUrl}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-slate-800 shrink-0 bg-slate-950/85">
          <div className="flex items-center gap-2 text-[10px] text-slate-500 justify-center">
            <Bot className="h-3 w-3 text-slate-600" />
            <span>
              Target: <span className="text-slate-400 font-mono">{state.ihvProvider}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
