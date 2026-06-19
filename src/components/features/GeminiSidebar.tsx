import { useState, useEffect, useRef, useMemo } from "react";
import { UIState } from "@/types";
import { cn } from "@/lib/utils";
import {
  buildAiWorkspaceContext,
  buildChatPresetQueries,
  buildWorkspaceContextSummary,
} from "@/lib/aiWorkspaceContext";
import {
  Sparkles, Bot, Send, X, RefreshCw, Zap, CheckCircle2,
  AlertTriangle, MessageSquareCode, Lightbulb, Check, Settings2, Key,
} from "lucide-react";

const PROVIDER_OPTIONS = [
  {
    id: "gemini",
    name: "Google Gemini",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    keyEnvVar: "GEMINI_API_KEY or GOOGLE_API_KEY",
    docsUrl: "aistudio.google.com",
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    keyEnvVar: "OPENAI_API_KEY",
    docsUrl: "platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    keyEnvVar: "ANTHROPIC_API_KEY",
    docsUrl: "console.anthropic.com",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    models: ["mistral-large-latest", "mistral-medium-latest", "ministral-8b-latest"],
    keyEnvVar: "MISTRAL_API_KEY",
    docsUrl: "console.mistral.ai",
  },
  {
    id: "openai-compat",
    name: "OpenAI-Compatible",
    models: [],
    keyEnvVar: "",
    docsUrl: "",
  },
] as const;

type ProviderId = (typeof PROVIDER_OPTIONS)[number]["id"];

interface GeminiSidebarProps {
  state: UIState;
  setState: (partial: Partial<UIState>) => void;
  isOpen: boolean;
  onClose: () => void;
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

export function GeminiSidebar({ state, setState, isOpen, onClose }: GeminiSidebarProps) {
  const [activeTab, setActiveTab] = useState<"audit" | "chat" | "settings">("audit");

  // Audit
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  // Chat
  const [chatMessages, setChatMessages] = useState<{ sender: "user" | "assistant"; text: string }[]>([{
    sender: "assistant",
    text: "Hello! I'm your **Olive AI Copilot**. I read your **live workspace** — model source, IHV target, passes, validation issues, and batch queue — and use that as context for every reply.\n\nUse the quick queries below (they update as you change the pipeline) or ask anything about optimization.",
  }]);
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

  const providerOption = PROVIDER_OPTIONS.find(p => p.id === settingsProvider)!;
  const isCompatMode = settingsProvider === "openai-compat";

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

  useEffect(() => {
    if (!isOpen) return;
    fetchProviderStatus().then(status => {
      if (status.source === "none") setActiveTab("settings");
    });
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !analysis && providerStatus.source !== "none") {
      handleRunAnalysis();
    }
  }, [isOpen, providerStatus.source]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatting]);

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
      const data = contentType.includes("application/json")
        ? await r.json().catch(() => ({}))
        : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      if (!contentType.includes("application/json")) {
        throw new Error("Server returned non-JSON. Restart with npm run dev (Express + API), not vite alone.");
      }
      setAnalysis(data as AnalysisResult);
    } catch (err: any) {
      setAnalysisError(err.message || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyAutofix = (autofix: Suggestion["autofix"]) => {
    if (!autofix?.pass) return;
    const { pass, value } = autofix;
    if (pass === "ihvProvider") {
      setState({ ihvProvider: value as any });
    } else if (pass === "cudaVersion") {
      setState({ cudaVersion: value as any });
    } else {
      const passKey = pass.startsWith("passes.") ? pass.slice(7) : pass;
      const parsed = value === "true" ? true : value === "false" ? false : isNaN(Number(value)) ? value : Number(value);
      setState({ passes: { ...state.passes, [passKey]: parsed as any } });
    }
    setTimeout(() => handleRunAnalysis(), 400);
  };

  const handleSendChat = async (presetText?: string) => {
    const text = presetText || inputQuestion;
    if (!text.trim()) return;
    setChatMessages(prev => [...prev, { sender: "user", text }]);
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
          chatHistory: chatMessages.map(m => ({ role: m.sender === "user" ? "user" : "assistant", content: m.text })),
        }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await r.json().catch(() => ({}))
        : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      if (!contentType.includes("application/json")) {
        throw new Error("Server returned non-JSON. Restart with npm run dev (Express + API), not vite alone.");
      }
      setChatMessages(prev => [...prev, { sender: "assistant", text: (data as { text?: string }).text || "No response generated." }]);
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
    if (isCompatMode && !settingsBaseUrl.trim()) {
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
          baseUrl: settingsBaseUrl.trim() || undefined,
        }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await r.json().catch(() => ({}))
        : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      await fetchProviderStatus();
      setSettingsApiKey("");
      setAnalysis(null);
      setActiveTab("audit");
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

  const isProviderError = (msg: string) =>
    msg.includes("not configured") ||
    msg.includes("API key") ||
    msg.includes("No AI provider") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("API route not found") ||
    msg.includes("not valid JSON") ||
    msg.includes("Unexpected token");

  const renderMessageContent = (text: string) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const lines = part.split("\n");
        return (
          <pre key={i} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[10px] font-mono text-emerald-400 my-1.5 overflow-x-auto whitespace-pre-wrap">
            {lines.slice(1, -1).join("\n")}
          </pre>
        );
      }
      return part.split("\n").map((line, j) => {
        const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ");
        const clean = isBullet ? line.trim().substring(2) : line;
        const elems: any[] = [];
        clean.split(/(\*\*.*?\*\*|`.*?`)/g).forEach((bp, k) => {
          if (bp.startsWith("**") && bp.endsWith("**"))
            elems.push(<strong key={k} className="font-bold text-slate-100">{bp.slice(2, -2)}</strong>);
          else if (bp.startsWith("`") && bp.endsWith("`"))
            elems.push(<code key={k} className="bg-slate-950 border border-slate-800 px-1 py-0.5 rounded text-[10px] font-mono text-cyan-400">{bp.slice(1, -1)}</code>);
          else elems.push(bp);
        });
        if (isBullet) return <li key={`${i}-${j}`} className="ml-3.5 list-disc text-xs text-slate-300 leading-relaxed my-0.5">{elems}</li>;
        if (line.trim().startsWith("### ")) return <h5 key={`${i}-${j}`} className="text-xs font-bold text-indigo-400 mt-2.5 mb-1 uppercase tracking-wider font-mono">{line.trim().substring(4)}</h5>;
        if (line.trim().startsWith("## ")) return <h4 key={`${i}-${j}`} className="text-xs font-bold text-slate-100 mt-3 mb-1.5 pb-0.5 border-b border-slate-800/80">{line.trim().substring(3)}</h4>;
        return <p key={`${i}-${j}`} className="text-xs text-slate-300 leading-relaxed my-0.5">{elems}</p>;
      });
    });
  };

  const ProviderErrorBlock = ({ msg, onGoSettings }: { msg: string; onGoSettings: () => void }) =>
    isProviderError(msg) ? (
      <div className="p-4 bg-slate-900 border border-slate-700 rounded-xl text-xs flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="font-bold text-sm">No AI Provider Configured</span>
        </div>
        <p className="text-slate-400 leading-relaxed">
          Configure a provider in the{" "}
          <button onClick={onGoSettings} className="text-electric-blue underline cursor-pointer">Settings tab</button>.
        </p>
        <p className="text-slate-500 text-[10px]">
          Or set an env var (<code className="bg-slate-800 px-1 rounded font-mono text-slate-300">GEMINI_API_KEY</code>,{" "}
          <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">GOOGLE_API_KEY</code>,{" "}
          <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">OPENAI_API_KEY</code>,{" "}
          <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">ANTHROPIC_API_KEY</code>,{" "}
          <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">MISTRAL_API_KEY</code>) in <code className="font-mono">.env</code> or <code className="font-mono">.env.local</code>, then restart <code className="font-mono">npm run dev</code>.
        </p>
      </div>
    ) : (
      <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-400 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
        <div><span className="font-bold block text-rose-200">Error</span>{msg}</div>
      </div>
    );

  const workspaceContext = useMemo(() => buildAiWorkspaceContext(state), [state]);
  const presetQueries = useMemo(() => buildChatPresetQueries(state), [state]);
  const workspaceSummary = useMemo(() => buildWorkspaceContextSummary(workspaceContext), [workspaceContext]);

  const providerLabel = providerStatus.source !== "none"
    ? `${PROVIDER_OPTIONS.find(p => p.id === providerStatus.provider)?.name ?? providerStatus.provider} / ${providerStatus.model}`
    : "No provider set";

  return (
    <div
      className={cn(
        "h-full shrink-0 overflow-hidden border-l border-slate-800 bg-slate-900 transition-[width] duration-300 ease-in-out",
        isOpen ? "w-[420px]" : "w-0 border-l-0"
      )}
      aria-hidden={!isOpen}
    >
      <div className="w-[420px] h-full flex flex-col shadow-[-4px_0_24px_rgba(3,7,18,0.25)]">
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800 shrink-0 bg-slate-950/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 px-2 bg-electric-blue/10 rounded-full border border-electric-blue/30 flex items-center gap-1.5 shrink-0">
            <Sparkles className="h-3 w-3 text-electric-blue" />
            <span className="text-[10px] font-extrabold font-mono text-electric-blue uppercase tracking-widest">AI Copilot</span>
          </div>
          <span className="text-[9px] font-mono text-slate-500 truncate">{providerLabel}</span>
        </div>
        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-800 border border-slate-800/55 flex items-center justify-center text-slate-400 hover:text-slate-100 transition-colors cursor-pointer shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="p-4 border-b border-slate-800/60 bg-slate-950/20 shrink-0">
        <div className="grid grid-cols-3 bg-slate-950/90 p-1 border border-slate-850 rounded-lg">
          {([
            { id: "audit" as const, label: "Audit", Icon: Lightbulb },
            { id: "chat" as const, label: "Chat", Icon: MessageSquareCode },
            { id: "settings" as const, label: "Settings", Icon: Settings2 },
          ]).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${activeTab === id ? "bg-slate-900 text-electric-blue shadow-sm border border-slate-800/40" : "text-slate-400 hover:text-slate-200"}`}
            >
              <Icon className={`h-3.5 w-3.5 ${activeTab === id ? "text-electric-blue" : "text-slate-500"}`} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Audit ── */}
        {activeTab === "audit" && (
          <div className="space-y-4">
            {analysis && !isAnalyzing && (
              <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 flex items-center gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-1 bg-indigo-500/10 text-[8px] font-mono uppercase tracking-widest text-indigo-400 border-l border-b border-slate-800 rounded-bl">AI advisory</div>
                <div className="relative h-16 w-16 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="32" cy="32" r="28" stroke="currentColor" className="text-slate-800" strokeWidth="4" fill="transparent" />
                    <circle cx="32" cy="32" r="28" stroke="currentColor" className="text-electric-blue transition-all duration-1000" strokeWidth="4" fill="transparent"
                      strokeDasharray={176} strokeDashoffset={176 - (176 * analysis.score) / 100} />
                  </svg>
                  <span className="absolute text-sm font-extrabold font-mono text-slate-100">{analysis.score}%</span>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">Pipeline Efficiency</h4>
                  <div className={`mt-0.5 text-[10px] inline-block px-1.5 py-0.5 rounded font-mono font-bold ${analysis.level === "Optimized" ? "bg-emerald-500/10 text-emerald-400" : analysis.level === "Suboptimal" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"}`}>
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
                <p className="text-[10px] text-slate-500 mt-0.5 font-mono animate-pulse">AI analysis agent inspecting</p>
              </div>
            )}

            {analysisError && <ProviderErrorBlock msg={analysisError} onGoSettings={() => setActiveTab("settings")} />}

            {analysis && !isAnalyzing && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 font-extrabold">Suggestions</span>
                  <button onClick={handleRunAnalysis} className="text-[10px] text-electric-blue hover:text-white flex items-center gap-1 cursor-pointer font-bold">
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                </div>
                <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-0.5">
                  {analysis.suggestions.map((s, i) => (
                    <div key={i} className={`p-3.5 rounded-lg border text-xs flex flex-col gap-3 bg-slate-950/45 transition-all ${s.type === "warning" ? "border-rose-500/20 hover:border-rose-500/40" : s.type === "success" ? "border-emerald-500/25 hover:border-emerald-500/40" : "border-slate-800 hover:border-slate-700"}`}>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-slate-100 flex items-center gap-1.5">
                            {s.type === "warning" ? <AlertTriangle className="h-3.5 w-3.5 text-rose-450 shrink-0" /> : s.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-450 shrink-0" /> : <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                            {s.title}
                          </span>
                          <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 rounded font-bold ${s.impact === "High" ? "bg-rose-500/10 text-rose-400" : "bg-slate-800 text-slate-400"}`}>{s.impact}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{s.description}</p>
                      </div>
                      {s.autofix?.pass && (
                        <div className="pt-2 border-t border-slate-900/60 flex items-center justify-between">
                          <span className="text-[9px] font-mono text-slate-500">→ {s.autofix.pass}</span>
                          <button onClick={() => handleApplyAutofix(s.autofix)} className="bg-electric-blue/10 text-electric-blue hover:bg-electric-blue hover:text-white border border-electric-blue/30 text-[10px] px-2.5 py-1 rounded font-bold flex items-center gap-1 transition-all cursor-pointer">
                            <Check className="h-3 w-3" /> Apply
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={handleRunAnalysis} disabled={isAnalyzing} className="w-full h-10 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 font-bold flex items-center justify-center gap-2 rounded-lg cursor-pointer transition-colors">
              <RefreshCw className={`h-3.5 w-3.5 text-indigo-400 ${isAnalyzing ? "animate-spin" : ""}`} />
              Analyze Optimization Pipeline
            </button>
          </div>
        )}

        {/* ── Chat ── */}
        {activeTab === "chat" && (
          <div className="flex flex-col h-full space-y-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <p className="text-[9px] font-mono uppercase tracking-wider text-slate-500 font-extrabold mb-1">
                Live workspace
              </p>
              <p className="text-[11px] text-slate-300 leading-relaxed font-mono" title={workspaceSummary}>
                {workspaceSummary}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-slate-950/50 border border-slate-850 rounded-xl min-h-[350px]">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`max-w-[90%] p-3 rounded-lg text-xs flex flex-col gap-1 ${msg.sender === "user" ? "bg-electric-blue/10 border border-electric-blue/20 ml-auto" : "bg-slate-900 border border-slate-800 mr-auto"}`}>
                  <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest font-extrabold mb-0.5 pb-0.5 border-b border-slate-800/40">
                    {msg.sender === "user" ? "Operator" : "AI Expert"}
                  </span>
                  <div>{renderMessageContent(msg.text)}</div>
                </div>
              ))}
              {isChatting && (
                <div className="p-3 bg-slate-900/60 border border-slate-850 rounded-lg animate-pulse flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 text-indigo-400 animate-spin" />
                  <span className="text-[10px] font-mono text-indigo-400">Thinking...</span>
                </div>
              )}
              {chatError && <ProviderErrorBlock msg={chatError} onGoSettings={() => setActiveTab("settings")} />}
              <div ref={chatEndRef} />
            </div>

            <div className="space-y-1.5 py-1">
              <span className="text-[9px] font-mono tracking-wider font-extrabold text-slate-500 uppercase block">Quick queries (from your pipeline)</span>
              <div className="flex flex-wrap gap-1.5">
                {presetQueries.map((prompt, i) => (
                  <button
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

            <form onSubmit={e => { e.preventDefault(); handleSendChat(); }} className="flex gap-2 pt-1.5 border-t border-slate-800/60">
              <input
                placeholder="Ask about optimization, passes, hardware..."
                value={inputQuestion}
                onChange={e => setInputQuestion(e.target.value)}
                disabled={isChatting}
                className="flex-1 min-w-0 bg-slate-950 border border-slate-800 hover:border-slate-700/80 focus:border-electric-blue/40 text-xs px-3 py-2 rounded-lg text-slate-200 focus:outline-none transition-colors"
              />
              <button type="submit" disabled={isChatting || !inputQuestion.trim()}
                className="h-9 w-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg flex items-center justify-center shrink-0 text-white cursor-pointer">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}

        {/* ── Settings ── */}
        {activeTab === "settings" && (
          <div className="space-y-5">
            {/* Active provider status */}
            <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold mb-2">Active Provider</p>
              {providerStatus.source === "none" ? (
                <p className="text-xs text-slate-500 italic">No provider. AI features disabled.</p>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      {PROVIDER_OPTIONS.find(p => p.id === providerStatus.provider)?.name ?? providerStatus.provider}
                    </p>
                    <p className="text-[10px] font-mono text-slate-400">{providerStatus.model} · {providerStatus.source === "env" ? "env var" : "session key"}</p>
                  </div>
                  {providerStatus.source === "user" && (
                    <button onClick={handleClearProvider} className="text-[10px] text-rose-400 hover:text-rose-200 border border-rose-500/20 rounded px-2 py-1 font-bold transition-all cursor-pointer">
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Configure new provider */}
            <div className="space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold">Configure Provider</p>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Provider</label>
                <select
                  value={settingsProvider}
                  onChange={e => {
                    const id = e.target.value as ProviderId;
                    setSettingsProvider(id);
                    const opt = PROVIDER_OPTIONS.find(p => p.id === id)!;
                    setSettingsModel(opt.models[0] ?? "");
                    setCustomModel("");
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
                >
                  {PROVIDER_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Model</label>
                {isCompatMode ? (
                  <input
                    placeholder="Model name (e.g. llama3.1:8b, deepseek-r1)"
                    value={customModel}
                    onChange={e => setCustomModel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                  />
                ) : (
                  <select
                    value={settingsModel}
                    onChange={e => setSettingsModel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
                  >
                    {providerOption.models.map(m => <option key={m} value={m}>{m}</option>)}
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
                    onChange={e => setSettingsBaseUrl(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                  />
                  <p className="text-[10px] text-slate-600 mt-1">Works with Ollama, LM Studio, vLLM, etc.</p>
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
                  onChange={e => setSettingsApiKey(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveProvider()}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
                />
              </div>

              {providerSaveError && <p className="text-xs text-rose-400">{providerSaveError}</p>}

              <button
                onClick={handleSaveProvider}
                disabled={isSavingProvider}
                className="w-full h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                {isSavingProvider ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save & Activate
              </button>

              {"docsUrl" in providerOption && providerOption.docsUrl && (
                <p className="text-[10px] text-slate-600 text-center">
                  Get key at <span className="font-mono text-slate-500">{providerOption.docsUrl}</span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3.5 border-t border-slate-800 shrink-0 bg-slate-950/85">
        <div className="flex items-center gap-2 text-[10px] text-slate-500 justify-center">
          <Bot className="h-3 w-3 text-slate-600" />
          <span>Target: <span className="text-slate-400 font-mono">{state.ihvProvider}</span></span>
        </div>
      </div>
      </div>
    </div>
  );
}
