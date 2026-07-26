import { useState, useEffect, useRef, useMemo, useTransition } from "react";
import { UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { cn } from "@/lib/utils";
import {
  buildAiWorkspaceContext,
  buildChatPresetQueries,
  buildWorkspaceContextSummary,
} from "@/lib/aiWorkspaceContext";
import {
  Bot,
  Send,
  X,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertTriangle,
  MessageSquareCode,
  Lightbulb,
  Check,
  Settings2,
  Key,
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

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
  // ── Subscription Services ────────────────────────────────────────────
  {
    id: "chatgpt-sub",
    name: "ChatGPT Subscription",
    models: ["gpt-4o", "gpt-4o-mini"],
    keyEnvVar: "OPENAI_API_KEY",
    docsUrl: "platform.openai.com/api-keys",
    category: "subscription",
    description: "Use your ChatGPT Plus/Pro API credits",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    models: ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet"],
    keyEnvVar: "GITHUB_TOKEN",
    docsUrl: "github.com/settings/tokens",
    baseUrl: "https://api.githubcopilot.com/v1",
    category: "subscription",
    description: "Copilot Pro subscription API access",
  },
  {
    id: "devin",
    name: "Devin",
    models: ["devin-latest"],
    keyEnvVar: "DEVIN_API_KEY",
    docsUrl: "devin.ai/settings",
    baseUrl: "https://api.devin.ai/v1",
    category: "subscription",
    description: "Cognition AI's autonomous coding agent",
  },
  {
    id: "kilocode",
    name: "Kilo Code",
    models: [],
    keyEnvVar: "",
    docsUrl: "kilocode.ai",
    category: "subscription",
    description: "AI coding assistant — uses your own API key",
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

interface GeminiSidebarProps {
  state?: UIState;
  setState?: (partial: Partial<UIState>) => void;
  isOpen: boolean;
  onClose: () => void;
  openToAudit?: boolean;
  onAuditOpened?: () => void;
}

interface Suggestion {
  title: string;
  description: string;
  impact: "High" | "Medium" | "Low";
  type: "warning" | "success" | "suggestion" | "info";
  autofix: { pass: string; value: string };
}

interface AnalysisResult {
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

const ProviderErrorBlock = ({ msg, onGoSettings }: { msg: string; onGoSettings: () => void }) => {
  const isProviderErr =
    msg.includes("not configured") ||
    msg.includes("API key") ||
    msg.includes("No AI provider") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("API route not found") ||
    msg.includes("not valid JSON") ||
    msg.includes("Unexpected token");

  return isProviderErr ? (
    <div className="p-4 bg-slate-900 border border-slate-700 rounded-xl text-xs flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-amber-400">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-bold text-sm">No AI Provider Configured</span>
      </div>
      <p className="text-slate-400 leading-relaxed">
        Configure a provider in the{" "}
        <button type="button" onClick={onGoSettings} className="text-electric-blue underline cursor-pointer">
          Settings tab
        </button>
        .
      </p>
      <p className="text-slate-500 text-[10px]">
        Or set an env var (
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">GEMINI_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">OPENAI_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">ANTHROPIC_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">XAI_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">OPENROUTER_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">GROQ_API_KEY</code>) in{" "}
        <code className="font-mono">.env</code> or <code className="font-mono">.env.local</code>, then restart{" "}
        <code className="font-mono">npm run dev</code>.
      </p>
    </div>
  ) : (
    <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-400 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
      <div>
        <span className="font-bold block text-rose-200">Error</span>
        {msg}
      </div>
    </div>
  );
};

/**
 * Displays installed local models and provides controls to search, load, and unload them.
 *
 * @param activeModel - The currently active model to highlight.
 * @param isOpen - Whether the sidebar is open and keyboard shortcuts should be enabled.
 */
function LocalModelManager({ activeModel, isOpen }: { activeModel?: string; isOpen: boolean }) {
  const [models, setModels] = useState<Array<{ id: string; loaded: boolean; source: "lms" | "ollama" }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedPublishers, setCollapsedPublishers] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const togglePublisher = (publisher: string) => {
    setCollapsedPublishers((prev) => {
      const next = new Set(prev);
      if (next.has(publisher)) next.delete(publisher);
      else next.add(publisher);
      return next;
    });
  };

  // Global Cmd+K / Ctrl+K to focus search input (only when sidebar is open)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q));
  }, [models, searchQuery]);

  // Group filtered models by publisher (first segment of model ID)
  const groupedModels = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; loaded: boolean; source: "lms" | "ollama" }>>();
    for (const m of filteredModels) {
      const parts = m.id.split("/");
      const publisher = parts.length > 1 ? parts[0] : "Other";
      if (!groups.has(publisher)) groups.set(publisher, []);
      groups.get(publisher)!.push(m);
    }
    // Sort publishers alphabetically, 'Other' last
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }, [filteredModels]);

  const refresh = async () => {
    setLoading(true);
    try {
      // Fetch from both LM Studio and Ollama in parallel
      const [lmsRes, ollamaRes] = await Promise.allSettled([
        fetch("/api/ai/local-models"),
        fetch("/api/ai/ollama-models"),
      ]);

      const lmsModels: string[] = [];
      const ollamaModels: string[] = [];
      const lmsLoaded: string[] = [];
      const ollamaLoaded: string[] = [];

      if (lmsRes.status === "fulfilled" && lmsRes.value.ok) {
        const d = await lmsRes.value.json();
        lmsModels.push(...(d.installedModels || []));
        lmsLoaded.push(...(d.loadedModels || []));
      }
      if (ollamaRes.status === "fulfilled" && ollamaRes.value.ok) {
        const d = await ollamaRes.value.json();
        ollamaModels.push(...(d.installedModels || []));
        ollamaLoaded.push(...(d.runningModels || []));
      }

      const allModels: Array<{ id: string; loaded: boolean; source: "lms" | "ollama" }> = [];
      const seen = new Set<string>();
      for (const id of lmsModels) {
        if (!seen.has(id)) {
          seen.add(id);
          allModels.push({ id, loaded: lmsLoaded.includes(id), source: "lms" });
        }
      }
      for (const id of ollamaModels) {
        if (!seen.has(id)) {
          seen.add(id);
          allModels.push({ id, loaded: ollamaLoaded.includes(id), source: "ollama" });
        }
      }
      setModels(allModels);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetch models on mount
    void refresh();
  }, []);

  const handleLoad = async (modelTag: string, source: "lms" | "ollama" = "lms") => {
    setBusy(modelTag);
    setError("");
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-load" : "/api/ai/local-load";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTag }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setBusy(null);
    }
  };

  const handleUnload = async (modelTag: string, source: "lms" | "ollama" = "lms") => {
    setBusy(modelTag);
    setError("");
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-unload" : "/api/ai/local-unload";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTag }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unload failed");
    } finally {
      setBusy(null);
    }
  };

  if (models.length === 0 && !loading) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold">
          Installed Models
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-[10px] text-slate-500 hover:text-electric-blue transition-colors cursor-pointer"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="space-y-1.5">
        {models.length > 3 && (
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search models… (⌘K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  searchInputRef.current?.blur();
                }
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 pr-5 text-[10px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {groupedModels.map(([publisher, pubModels]) => {
            const isCollapsed = collapsedPublishers.has(publisher);
            return (
              <div key={publisher}>
                <button
                  type="button"
                  onClick={() => togglePublisher(publisher)}
                  aria-expanded={!isCollapsed}
                  className="w-full flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-200 font-mono font-bold uppercase tracking-wider cursor-pointer py-0.5"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                  <span>{publisher}</span>
                  <span className="text-slate-600 font-normal">({pubModels.length})</span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1 mt-0.5">
                    {pubModels.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-800 bg-slate-950/60 text-[11px]"
                      >
                        <span
                          className="font-mono text-slate-300 truncate flex-1 flex items-center gap-1.5"
                          title={m.id}
                        >
                          {activeModel &&
                            (m.id === activeModel ||
                              activeModel.endsWith(m.id) ||
                              m.id.endsWith(activeModel)) && (
                              <span
                                className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                                title="Active model"
                              />
                            )}
                          {m.id.split("/").pop() || m.id}
                        </span>
                        {m.loaded ? (
                          <button
                            type="button"
                            onClick={() => void handleUnload(m.id, m.source)}
                            disabled={busy === m.id}
                            className="text-[10px] px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {busy === m.id ? "…" : "Unload"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleLoad(m.id, m.source)}
                            disabled={busy === m.id}
                            className="text-[10px] px-2 py-0.5 rounded border border-electric-blue/30 text-electric-blue hover:bg-electric-blue/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {busy === m.id ? "…" : "Load"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {searchQuery.trim() && filteredModels.length === 0 && (
          <p className="text-[10px] text-slate-500 italic text-center py-1">
            No models match "{searchQuery}"
          </p>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}

/**
 * Renders a sidebar for auditing, chatting about, and configuring the optimization pipeline.
 *
 * @param state - Optional pipeline state; when omitted, the sidebar uses the pipeline store.
 * @param setState - Optional pipeline state updater; when omitted, the sidebar uses the pipeline store.
 * @param isOpen - Whether the sidebar is visible.
 * @param onClose - Called when the sidebar is closed.
 * @param openToAudit - Whether to open the audit tab and run an analysis.
 * @param onAuditOpened - Called after an audit is opened in response to `openToAudit`.
 */
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
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [localPullError, setLocalPullError] = useState<string>("");
  const [modelSizes, setModelSizes] = useState<Record<string, number>>({});
  const [ollamaHealthy, setOllamaHealthy] = useState<boolean | null>(null);
  const [preferredEngine, setPreferredEngine] = useState<"lms" | "ollama">(() => {
    try {
      return (localStorage.getItem("localEngine") as "lms" | "ollama") || "lms";
    } catch {
      return "lms";
    }
  });
  const [showOtherEngine, setShowOtherEngine] = useState(false);

  const handleSetPreferredEngine = (engine: "lms" | "ollama") => {
    setPreferredEngine(engine);
    setShowOtherEngine(false);
    try {
      localStorage.setItem("localEngine", engine);
    } catch {
      /* ignore */
    }
  };

  // Check Ollama health on mount and when sidebar opens
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/ai/ollama-health")
      .then((r) => r.json())
      .then((d) => setOllamaHealthy(d.healthy ?? false))
      .catch(() => setOllamaHealthy(false));
  }, [isOpen]);

  const handlePullLocalModel = async (modelTag: string, source: "lms" | "ollama" = "lms") => {
    setPullingModel(modelTag);
    setLocalPullError("");
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-pull" : "/api/ai/local-pull";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTag }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await r.json().catch(() => ({})) : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      await fetchProviderStatus();
      setAnalysis(null);
      setActiveTab("audit");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setLocalPullError(err.message || "Failed to pull local model.");
    } finally {
      setPullingModel(null);
    }
  };

  const providerOption = PROVIDER_OPTIONS.find((p) => p.id === settingsProvider)!;
  const isCompatMode = settingsProvider === "openai-compat" || !!providerOption.baseUrl;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setState({ passes: { ...state.passes, [passKey]: parsed as any } });
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

  const handleSaveProvider = async () => {
    const key = settingsApiKey.trim();
    const model = isCompatMode ? customModel.trim() : settingsModel;
    if (!key) {
      setProviderSaveError("Enter an API key.");
      return;
    }
    if (!model) {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setProviderSaveError(err.message || "Failed to save provider.");
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
            <div className="space-y-4">
              {analysis && !isAnalyzing && (
                <div className="bg-slate-950/70 rounded border border-slate-800 flex items-center gap-4 p-4">
                  <div className="relative h-16 w-16 shrink-0 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        stroke="currentColor"
                        className="text-slate-800"
                        strokeWidth="4"
                        fill="transparent"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        stroke="currentColor"
                        className="text-electric-blue transition-all duration-1000"
                        strokeWidth="4"
                        fill="transparent"
                        strokeDasharray={176}
                        strokeDashoffset={176 - (176 * analysis.score) / 100}
                      />
                    </svg>
                    <span className="absolute text-sm font-extrabold font-mono text-slate-100">
                      {analysis.score}%
                    </span>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-slate-100">Pipeline efficiency</h4>
                    <div
                      className={`mt-0.5 text-[10px] inline-block px-1.5 py-0.5 rounded font-mono font-bold ${analysis.level === "Optimized" ? "bg-emerald-500/10 text-emerald-400" : analysis.level === "Suboptimal" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"}`}
                    >
                      {analysis.level} Mode
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{analysis.summary}</p>
                  </div>
                </div>
              )}

              {isAnalyzing && (
                <div className="text-center py-12 bg-slate-950/30 border border-slate-800 rounded-lg flex flex-col items-center justify-center">
                  <RefreshCw className="h-7 w-7 text-electric-blue animate-spin mb-3" />
                  <p className="text-xs font-medium text-slate-300">Auditing pipeline...</p>
                  <p className="text-xs text-slate-500 mt-0.5">Inspecting workspace…</p>
                </div>
              )}

              {analysisError && (
                <ProviderErrorBlock msg={analysisError} onGoSettings={() => setActiveTab("settings")} />
              )}

              {analysis && !isAnalyzing && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-medium">Suggestions</span>
                    <button
                      type="button"
                      onClick={handleRunAnalysis}
                      className="text-[10px] text-electric-blue hover:text-white flex items-center gap-1 cursor-pointer font-bold"
                    >
                      <RefreshCw className="h-3 w-3" /> Refresh
                    </button>
                  </div>
                  <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-0.5">
                    {analysis.suggestions.map((s, i) => (
                      <div
                        key={i}
                        className={`p-3.5 rounded-lg border text-xs flex flex-col gap-3 bg-slate-950/45 transition-all ${s.type === "warning" ? "border-rose-500/20 hover:border-rose-500/40" : s.type === "success" ? "border-emerald-500/25 hover:border-emerald-500/40" : "border-slate-800 hover:border-slate-700"}`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-bold text-slate-100 flex items-center gap-1.5">
                              {s.type === "warning" ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-rose-450 shrink-0" />
                              ) : s.type === "success" ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-450 shrink-0" />
                              ) : (
                                <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                              )}
                              {s.title}
                            </span>
                            <span
                              className={`text-[9px] font-mono uppercase tracking-widest px-1.5 rounded font-bold ${s.impact === "High" ? "bg-rose-500/10 text-rose-400" : "bg-slate-800 text-slate-400"}`}
                            >
                              {s.impact}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">{s.description}</p>
                        </div>
                        {s.autofix?.pass && (
                          <div className="pt-2 border-t border-slate-900/60 flex items-center justify-between">
                            <span className="text-[9px] font-mono text-slate-500">→ {s.autofix.pass}</span>
                            <button
                              type="button"
                              onClick={() => handleApplyAutofix(s.autofix)}
                              className="bg-electric-blue/10 text-electric-blue hover:bg-electric-blue hover:text-white border border-electric-blue/30 text-[10px] px-2.5 py-1 rounded font-bold flex items-center gap-1 transition-all cursor-pointer"
                            >
                              <Check className="h-3 w-3" /> Apply
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleRunAnalysis}
                disabled={isAnalyzing}
                className="w-full h-10 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 font-bold flex items-center justify-center gap-2 rounded-lg cursor-pointer transition-colors"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-electric-blue ${isAnalyzing ? "animate-spin" : ""}`}
                />
                Analyze Optimization Pipeline
              </button>
            </div>
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
                {(preferredEngine === "lms" || showOtherEngine) && (
                  <>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {preferredEngine === "lms"
                        ? "Download & enable a local model via LM Studio (Llmster) to run Olive Studio AI features offline with zero cloud keys:"
                        : "LM Studio models (click above to switch to LM Studio as preferred engine):"}
                    </p>
                    <div className="space-y-2">
                      {(
                        [
                          {
                            tag: "lmstudio-community/Qwen2.5-Coder-1.5B-Instruct-GGUF",
                            name: "Qwen2.5-Coder (1.5B)",
                            desc: "⭐ Recommended: Best tool-calling accuracy & Olive recipe precision",
                            fallbackSize: "1.1 GB",
                          },
                          {
                            tag: "lmstudio-community/Meta-Llama-3.2-1B-Instruct-GGUF",
                            name: "Llama-3.2 (1B)",
                            desc: "⚡ Ultra-lightweight: Lowest RAM footprint (<1.2GB)",
                            fallbackSize: "800 MB",
                          },
                          {
                            tag: "lmstudio-community/Phi-3.5-Mini-Instruct-GGUF",
                            name: "Phi-3.5-Mini (3.8B)",
                            desc: "🧠 Advanced Reasoning: Complex compiler co-design",
                            fallbackSize: "2.2 GB",
                          },
                        ] as const
                      ).map((m) => {
                        // Find actual size by matching tag against LM Studio model keys
                        const sizeBytes = Object.entries(modelSizes).find(
                          ([key]) =>
                            key
                              .toLowerCase()
                              .includes(m.tag.split("/").pop()?.toLowerCase().split("-")[0] ?? "") ||
                            m.tag.toLowerCase().includes(key.toLowerCase().split("/").pop() ?? ""),
                        )?.[1];
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
                              onClick={() => handlePullLocalModel(m.tag)}
                              disabled={pullingModel === m.tag}
                              className="mt-1 w-full h-7 bg-electric-blue/10 hover:bg-electric-blue/20 text-electric-blue border border-electric-blue/30 rounded text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
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
                    {localPullError && <p className="text-xs text-rose-400 mt-1">{localPullError}</p>}

                    {/* Load/Unloaded models list */}
                    <LocalModelManager activeModel={providerStatus.model} isOpen={isOpen} />

                    {/* Other engine toggle */}
                    <button
                      type="button"
                      onClick={() => setShowOtherEngine(!showOtherEngine)}
                      className="w-full text-[10px] text-slate-500 hover:text-slate-300 border border-dashed border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2 transition-all cursor-pointer"
                    >
                      {showOtherEngine ? "Hide" : "Show"} {preferredEngine === "lms" ? "Ollama" : "LM Studio"}{" "}
                      models
                    </button>
                  </>
                )}

                {/* Ollama 1-Click Setup */}
                {(preferredEngine === "ollama" || showOtherEngine) && (
                  <>
                    <div className="pt-3 border-t border-slate-800/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 font-bold text-xs text-emerald-400">
                          <Download className="h-4 w-4" />
                          <span>
                            {preferredEngine === "ollama"
                              ? "Ollama models"
                              : "Ollama models (alternative engine)"}
                          </span>
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${ollamaHealthy === true ? "bg-emerald-400" : ollamaHealthy === false ? "bg-rose-400" : "bg-slate-500"}`}
                            title={
                              ollamaHealthy === true
                                ? "Ollama server running"
                                : ollamaHealthy === false
                                  ? "Ollama server not reachable"
                                  : "Checking Ollama..."
                            }
                          />
                        </div>
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">
                          Alternative Engine
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed mb-2">
                        Download & enable a local model via Ollama — same models, different engine. Uses the
                        Ollama API on{" "}
                        <code className="text-[10px] font-mono text-slate-400">localhost:11434</code>.
                      </p>
                      <div className="space-y-2">
                        {(
                          [
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
                              tag: "phi3.5:3.8b",
                              name: "Phi-3.5-Mini (3.8B)",
                              desc: "🧠 Advanced Reasoning: Complex compiler co-design",
                              fallbackSize: "2.2 GB",
                            },
                          ] as const
                        ).map((m) => {
                          // Find actual size by matching tag against Ollama model names
                          const sizeBytes = Object.entries(modelSizes).find(
                            ([key]) =>
                              key === m.tag ||
                              key.toLowerCase().includes(m.tag.split(":")[0]?.toLowerCase() ?? "") ||
                              m.tag.toLowerCase().includes(key.toLowerCase()),
                          )?.[1];
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
                                onClick={() => handlePullLocalModel(m.tag, "ollama")}
                                disabled={pullingModel === m.tag}
                                className="mt-1 w-full h-7 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
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
                    </div>
                  </>
                )}
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
                      setSettingsModel(opt.models[0] ?? "");
                      setCustomModel("");
                      setSettingsBaseUrl(opt.baseUrl ?? "");
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
                  <label htmlFor="gemini-settings-model" className="text-xs text-slate-400 mb-1 block">
                    Model
                  </label>
                  {isCompatMode ? (
                    <input
                      placeholder="Model name (e.g. llama3.1:8b, deepseek-r1)"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                    />
                  ) : (
                    <select
                      id="gemini-settings-model"
                      aria-label="AI model"
                      value={settingsModel}
                      onChange={(e) => setSettingsModel(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
                    >
                      {providerOption.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {isCompatMode && (
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Base URL</label>
                    <input
                      type="text"
                      placeholder="http://localhost:11434/v1"
                      value={settingsBaseUrl}
                      onChange={(e) => setSettingsBaseUrl(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                    />
                    <p className="text-[10px] text-slate-600 mt-1">
                      Works with LM Studio, vLLM, Ollama, etc. (default: http://localhost:11434/v1)
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
                    onKeyDown={(e) => e.key === "Enter" && handleSaveProvider()}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                  />
                </div>

                {providerSaveError && <p className="text-xs text-rose-400">{providerSaveError}</p>}

                <button
                  type="button"
                  onClick={handleSaveProvider}
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

                {"docsUrl" in providerOption && providerOption.docsUrl && (
                  <p className="text-[10px] text-slate-600 text-center">
                    Get key at <span className="font-mono text-slate-500">{providerOption.docsUrl}</span>
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
