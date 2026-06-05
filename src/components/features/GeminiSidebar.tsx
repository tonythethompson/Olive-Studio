import { useState, useEffect } from "react";
import { UIState } from "@/types";
import { 
  Sparkles, Bot, Send, X, RefreshCw, Zap, CheckCircle2, 
  AlertTriangle, HelpCircle, ChevronRight, MessageSquareCode, 
  Lightbulb, ArrowRight, Check, Play
} from "lucide-react";

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
  autofix: {
    pass: "quantization" | "ihvProvider" | "onnxTransforms" | "pruning" | "peft";
    value: string;
  };
}

interface AnalysisResult {
  score: number;
  level: string;
  summary: string;
  suggestions: Suggestion[];
}

export function GeminiSidebar({ state, setState, isOpen, onClose }: GeminiSidebarProps) {
  const [activeTab, setActiveTab] = useState<"audit" | "chat">("audit");
  
  // Audit Analysis State
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  // Chat State
  const [chatMessages, setChatMessages] = useState<Array<{ sender: "user" | "assistant"; text: string; timestamp: Date }>>([
    {
      sender: "assistant",
      text: "Hello! I am your **Olive AI Copilot**. I have access to your live **model, custom passes & hardware target selections**.\n\nAsk me any question (e.g. *'How do I quantize for DirectML?'*) or run the pipeline audit for instant hardware diagnostics!",
      timestamp: new Date()
    }
  ]);
  const [inputQuestion, setInputQuestion] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [chatError, setChatError] = useState("");

  // Auto trigger analysis on initial open
  useEffect(() => {
    if (isOpen && !analysis) {
      handleRunAnalysis();
    }
  }, [isOpen]);

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError("");
    try {
      const response = await fetch("/api/gemini/analyze-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status} Failed to run analysis.`);
      }
      const data = await response.json();
      setAnalysis(data);
    } catch (err: any) {
      console.error(err);
      setAnalysisError(err.message || "Pipeline analysis offline. Try verifying your network settings.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyAutofix = (autofix: Suggestion["autofix"]) => {
    if (!autofix || !autofix.pass) return;

    const key = autofix.pass;
    const value = autofix.value;

    if (key === "ihvProvider") {
      setState({ ihvProvider: value as any });
    } else {
      // Toggle a pass boolean
      const booleanVal = value === "true";
      setState({
        passes: {
          ...state.passes,
          [key]: booleanVal
        }
      });
    }

    // Trigger re-analysis automatically to update suggestions
    setTimeout(() => {
      handleRunAnalysis();
    }, 400);
  };

  const handleSendChat = async (presetText?: string) => {
    const textToSend = presetText || inputQuestion;
    if (!textToSend.trim()) return;

    const userMsg = { sender: "user" as const, text: textToSend, timestamp: new Date() };
    setChatMessages(prev => [...prev, userMsg]);
    
    if (!presetText) setInputQuestion("");
    setIsChatting(true);
    setChatError("");

    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          recipeJson: JSON.stringify(state, null, 2),
          chatHistory: chatMessages.map(m => ({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.text
          })),
          ihvProvider: state.ihvProvider
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status} failed to fetch answer.`);
      }

      const data = await response.json();
      setChatMessages(prev => [...prev, {
        sender: "assistant" as const,
        text: data.text,
        timestamp: new Date()
      }]);
    } catch (err: any) {
      console.error(err);
      setChatError(err.message || "Failed to obtain advice from Gemini server.");
    } finally {
      setIsChatting(false);
    }
  };

  // Helper formatting for rich chat response bubbles
  const renderMessageContent = (text: string) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const lines = part.split("\n");
        const content = lines.slice(1, -1).join("\n");
        return (
          <pre key={index} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[10px] font-mono text-emerald-400 my-1.5 overflow-x-auto whitespace-pre-wrap">
            {content}
          </pre>
        );
      }
      
      const lines = part.split("\n");
      return lines.map((line, lineIdx) => {
        let isBullet = false;
        let cleanLine = line;
        if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
          isBullet = true;
          cleanLine = line.trim().substring(2);
        }
        
        const elements: any[] = [];
        const boldParts = cleanLine.split(/(\*\*.*?\*\*|`.*?`)/g);
        boldParts.forEach((bp, bpIdx) => {
          if (bp.startsWith("**") && bp.endsWith("**")) {
            elements.push(<strong key={bpIdx} className="font-bold text-slate-100">{bp.slice(2, -2)}</strong>);
          } else if (bp.startsWith("`") && bp.endsWith("`")) {
            elements.push(<code key={bpIdx} className="bg-slate-950 border border-slate-800 px-1 py-0.5 rounded text-[10px] font-mono text-cyan-400">{bp.slice(1, -1)}</code>);
          } else {
            elements.push(bp);
          }
        });

        if (isBullet) {
          return (
            <li key={`${index}-${lineIdx}`} className="ml-3.5 list-disc text-xs text-slate-300 leading-relaxed my-0.5">
              {elements}
            </li>
          );
        }

        if (line.trim().startsWith("### ")) {
          return <h5 key={`${index}-${lineIdx}`} className="text-xs font-bold text-indigo-400 mt-2.5 mb-1 uppercase tracking-wider font-mono">{line.trim().substring(4)}</h5>;
        }
        if (line.trim().startsWith("## ")) {
          return <h4 key={`${index}-${lineIdx}`} className="text-xs font-bold text-slate-100 mt-3 mb-1.5 pb-0.5 border-b border-slate-800/80">{line.trim().substring(3)}</h4>;
        }

        return (
          <p key={`${index}-${lineIdx}`} className="text-xs text-slate-300 leading-relaxed my-0.5">
            {elements}
          </p>
        );
      });
    });
  };

  return (
    <div 
      className={`fixed top-0 right-0 h-full w-[420px] bg-slate-900/95 backdrop-blur-md border-l border-slate-800 z-50 flex flex-col transition-all duration-300 ease-in-out shadow-[-10px_0_40px_rgba(3,7,18,0.45)] transform ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Sidebar Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800 shrink-0 bg-slate-950/80">
        <div className="flex items-center gap-2">
          <div className="p-1 px-2 bg-electric-blue/10 rounded-full border border-electric-blue/30 flex items-center gap-1.5 shrink-0 animate-pulse">
            <Sparkles className="h-3 w-3 text-electric-blue" />
            <span className="text-[10px] font-extrabold font-mono text-electric-blue uppercase tracking-widest">Gemini Copilot</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-lg hover:bg-slate-800 border border-slate-800/55 flex items-center justify-center text-slate-400 hover:text-slate-100 transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Selector Tabs */}
      <div className="p-4 border-b border-slate-800/60 bg-slate-950/20 shrink-0">
        <div className="grid grid-cols-2 bg-slate-950/90 p-1 border border-slate-850 rounded-lg">
          <button
            onClick={() => setActiveTab("audit")}
            className={`py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "audit" 
                ? "bg-slate-900 text-electric-blue shadow-sm border border-slate-800/40" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Lightbulb className={`h-3.5 w-3.5 ${activeTab === "audit" ? "text-electric-blue" : "text-slate-500"}`} />
            Pipeline Audit
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "chat" 
                ? "bg-slate-900 text-electric-blue shadow-sm border border-slate-800/40" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <MessageSquareCode className={`h-3.5 w-3.5 ${activeTab === "chat" ? "text-electric-blue" : "text-slate-500"}`} />
            Copilot Chat
          </button>
        </div>
      </div>

      {/* Tab Content Box */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === "audit" ? (
          <div className="space-y-4">
            {/* Interactive State Summary Board */}
            {analysis && !isAnalyzing && (
              <div className="bg-slate-950/70 rounded-xl p-4 border border-slate-800 flex items-center gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-1 bg-indigo-500/10 text-[8px] font-mono uppercase tracking-widest text-indigo-400 border-l border-b border-slate-800 rounded-bl font-sans">
                  Live State
                </div>
                {/* Visual Circle Gauge */}
                <div className="relative h-16 w-16 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="32" cy="32" r="28" stroke="currentColor" className="text-slate-800" strokeWidth="4" fill="transparent" />
                    <circle cx="32" cy="32" r="28" stroke="currentColor" className="text-electric-blue transition-all duration-1000" strokeWidth="4" fill="transparent"
                      strokeDasharray={176}
                      strokeDashoffset={176 - (176 * analysis.score) / 100}
                    />
                  </svg>
                  <span className="absolute text-sm font-extrabold font-mono text-slate-100">{analysis.score}%</span>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider">Pipeline Efficiency</h4>
                  <div className={`mt-0.5 text-[10px] inline-block px-1.5 py-0.5 rounded font-mono font-bold ${
                    analysis.level === "Optimized" 
                      ? "bg-emerald-500/10 text-emerald-400" 
                      : analysis.level === "Suboptimal" 
                      ? "bg-amber-500/10 text-amber-400" 
                      : "bg-rose-500/10 text-rose-400"
                  }`}>
                    {analysis.level} Mode
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{analysis.summary}</p>
                </div>
              </div>
            )}

            {isAnalyzing && (
              <div className="text-center py-12 bg-slate-950/30 border border-slate-800 rounded-lg flex flex-col items-center justify-center">
                <RefreshCw className="h-7 w-7 text-electric-blue animate-spin mb-3" />
                <p className="text-xs font-medium text-slate-300">Auditing Active Switches...</p>
                <p className="text-[10px] text-slate-500 mt-0.5 font-mono animate-pulse">Gemini co-design agent inspecting</p>
              </div>
            )}

            {analysisError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-400 flex items-start gap-2 animate-bounce">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                <div>
                  <span className="font-bold block text-rose-200">Diagnostics Incomplete</span>
                  {analysisError}
                </div>
              </div>
            )}

            {/* List of suggestions */}
            {analysis && !isAnalyzing && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 font-extrabold">State-Based Suggestions</span>
                  <button 
                    onClick={handleRunAnalysis}
                    className="text-[10px] text-electric-blue hover:text-white flex items-center gap-1 cursor-pointer font-bold"
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-0.5">
                  {analysis.suggestions.map((suggestion, index) => (
                    <div 
                      key={index}
                      className={`p-3.5 rounded-lg border text-xs leading-relaxed transition-all flex flex-col justify-between gap-3 bg-slate-950/45 ${
                        suggestion.type === "warning" 
                          ? "border-rose-500/20 hover:border-rose-500/40" 
                          : suggestion.type === "success" 
                          ? "border-emerald-500/25 hover:border-emerald-500/40"
                          : "border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-slate-100 flex items-center gap-1.5">
                            {suggestion.type === "warning" ? (
                              <AlertTriangle className="h-3.5 w-3.5 text-rose-450 mt-0.5 shrink-0" />
                            ) : suggestion.type === "success" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-450 mt-0.5 shrink-0" />
                            ) : (
                              <Zap className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                            )}
                            {suggestion.title}
                          </span>
                          <span className={`text-[9px] font-mono uppercase tracking-widest px-1.5 rounded font-bold ${
                            suggestion.impact === "High" 
                              ? "bg-rose-500/10 text-rose-400" 
                              : "bg-slate-800 text-slate-400"
                          }`}>
                            {suggestion.impact} Impact
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-405 leading-relaxed">{suggestion.description}</p>
                      </div>

                      {suggestion.autofix && (
                        <div className="pt-2 border-t border-slate-900/60 flex items-center justify-between shrink-0">
                          <span className="text-[9px] font-mono text-slate-500">
                            Updates: {suggestion.autofix.pass}
                          </span>
                          <button
                            onClick={() => handleApplyAutofix(suggestion.autofix)}
                            className="bg-electric-blue/10 text-electric-blue hover:bg-electric-blue hover:text-white border border-electric-blue/30 text-[10px] px-2.5 py-1 rounded font-bold flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <Check className="h-3 w-3" /> Quick Apply
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* General Trigger Button */}
            <div className="pt-1.5">
              <button
                onClick={handleRunAnalysis}
                disabled={isAnalyzing}
                className="w-full h-10 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 transition-colors font-bold flex items-center justify-center gap-2 rounded-lg cursor-pointer shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-indigo-400 ${isAnalyzing ? "animate-spin" : ""}`} />
                Analyze Model Optimization Efficiency
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full space-y-3 justify-between">
            {/* Chat Box Window */}
            <div className="flex-1 overflow-y-auto space-y-3 p-3 bg-slate-950/50 border border-slate-850 rounded-xl min-h-[350px]">
              {chatMessages.map((msg, index) => (
                <div 
                  key={index}
                  className={`max-w-[90%] p-3 rounded-lg text-xs leading-relaxed flex flex-col gap-1 ${
                    msg.sender === "user" 
                      ? "bg-electric-blue/10 border border-electric-blue/20 ml-auto" 
                      : "bg-slate-900 border border-slate-800 mr-auto"
                  }`}
                >
                  <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest font-extrabold mb-0.5 pb-0.5 border-b border-slate-800/40">
                    {msg.sender === "user" ? "Operator" : "Olive Expert AI"}
                  </span>
                  <div>{renderMessageContent(msg.text)}</div>
                </div>
              ))}

              {isChatting && (
                <div className="p-3 bg-slate-900/60 border border-slate-850 rounded-lg animate-pulse flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5 text-indigo-400 animate-spin" />
                  <span className="text-[10px] font-mono text-indigo-400">Gemini formulation active...</span>
                </div>
              )}

              {chatError && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/35 rounded text-[11px] text-rose-400">
                  {chatError}
                </div>
              )}
            </div>

            {/* Quick Helper Chips */}
            <div className="space-y-1.5 py-1">
              <span className="text-[9px] font-mono tracking-wider font-extrabold text-slate-500 uppercase block">Preset Helper Queries</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Which quant fits CUDA最佳?",
                  "Recommend passes for LLM 4-bit config",
                  "Why would pruning collapse model metric accuracy?"
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendChat(prompt)}
                    disabled={isChatting}
                    className="text-[10px] px-2.5 py-0.5 bg-slate-950/80 hover:bg-slate-900 text-slate-400 hover:text-slate-100 border border-slate-800 rounded transition-all cursor-pointer font-sans"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Send Question Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendChat();
              }}
              className="flex gap-2 pt-1.5 border-t border-slate-800/60 bg-slate-900/40"
            >
              <input
                placeholder="Ask model compiling or state questions..."
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                disabled={isChatting}
                className="flex-1 min-w-0 bg-slate-950 border border-slate-800 hover:border-slate-700/80 focus:border-electric-blue/40 text-xs px-3 py-2 rounded-lg text-slate-200 focus:outline-none transition-colors"
                type="text"
              />
              <button
                type="submit"
                disabled={isChatting || !inputQuestion.trim()}
                className="h-9 w-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg transition-all flex items-center justify-center shrink-0 text-white cursor-pointer"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Footer Info Box */}
      <div className="p-3.5 border-t border-slate-800 shrink-0 bg-slate-950/85">
        <div className="flex items-center gap-2 text-[10px] text-slate-500 justify-center">
          <Bot className="h-3 w-3 text-slate-600" />
          <span>Active Device Context: <span className="text-slate-400 font-mono">{state.ihvProvider}</span></span>
        </div>
      </div>
    </div>
  );
}
