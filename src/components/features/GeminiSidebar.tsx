import { useState, useEffect, useMemo, useTransition, useRef } from "react";
import { UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { cn } from "@/lib/utils";
import {
  buildAiWorkspaceContext,
  buildChatPresetQueries,
  buildWorkspaceContextSummary,
} from "@/lib/aiWorkspaceContext";
import { chatPatchToUiState, sanitizeChatActionPatch, type ChatAction } from "@/lib/chatActions";
import { Bot, X, Lightbulb, MessageSquareCode, Settings2, Bug } from "lucide-react";
import { AuditPanel } from "./AuditPanel";
import { ReportIssueModal } from "@/components/ReportIssueModal";
import { PROVIDER_OPTIONS, normalizeUiProviderId } from "./gemini/aiProviderCatalog";
import { ChatPanel } from "./gemini/ChatPanel";
import { SettingsPanel } from "./gemini/SettingsPanel";
import type { SidebarTab } from "./gemini/types";
import { useAiAudit } from "./gemini/useAiAudit";
import { useAiChat } from "./gemini/useAiChat";
import { useAiProviderSettings } from "./gemini/useAiProviderSettings";
import { useLocalEngineSetup } from "./gemini/useLocalEngineSetup";

export type { AnalysisResult, Suggestion } from "./gemini/types";

interface GeminiSidebarProps {
  state?: UIState;
  setState?: (partial: Partial<UIState>) => void;
  isOpen: boolean;
  onClose: () => void;
  openToAudit?: boolean;
  onAuditOpened?: () => void;
}

const TABS = [
  { id: "audit" as const, label: "Audit", Icon: Lightbulb },
  { id: "chat" as const, label: "Chat", Icon: MessageSquareCode },
  { id: "settings" as const, label: "Settings", Icon: Settings2 },
];

/**
 * Renders a sidebar for pipeline auditing, workspace-aware chat, and AI provider configuration.
 *
 * @param isOpen - Whether the sidebar is visible
 * @param onClose - Callback invoked when the sidebar is closed
 * @param openToAudit - Whether to select the audit tab and restart analysis
 * @param onAuditOpened - Optional callback invoked after the audit tab is opened
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
  const [activeTab, setActiveTab] = useState<SidebarTab>("audit");
  const [, startTabTransition] = useTransition();

  const handleTabChange = (tab: SidebarTab) => {
    startTabTransition(() => {
      setActiveTab(tab);
    });
  };

  const workspaceContext = useMemo(() => buildAiWorkspaceContext(state), [state]);
  const presetQueries = useMemo(() => buildChatPresetQueries(state), [state]);
  const workspaceSummary = useMemo(() => buildWorkspaceContextSummary(workspaceContext), [workspaceContext]);

  const audit = useAiAudit({ state, setState });
  const chat = useAiChat(workspaceContext);
  const chatActionAuditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (chatActionAuditTimerRef.current) clearTimeout(chatActionAuditTimerRef.current);
    };
  }, []);

  const handleApplyChatAction = (messageIndex: number, action: ChatAction) => {
    const patch = sanitizeChatActionPatch(action.patch);
    if (!patch) return;
    const partial = chatPatchToUiState(state, patch);
    const next: UIState = {
      ...state,
      ...partial,
      passes: partial.passes ?? state.passes,
    };
    setState(partial);
    chat.markActionApplied(messageIndex, action.id);
    if (chatActionAuditTimerRef.current) clearTimeout(chatActionAuditTimerRef.current);
    chatActionAuditTimerRef.current = setTimeout(() => {
      chatActionAuditTimerRef.current = null;
      void audit.runAnalysis({ stateOverride: next });
    }, 400);
  };

  const providers = useAiProviderSettings({
    isOpen,
    activeTab,
    onProviderActivated: () => {
      audit.resetAnalysis();
      setActiveTab("audit");
    },
    onProviderCleared: audit.resetAnalysis,
    onProviderMissing: () => setActiveTab("settings"),
  });

  const local = useLocalEngineSetup({
    isOpen,
    onModelActivated: async (modelTag, source) => {
      const ok = await providers.enableLocalAiProvider(source, modelTag);
      if (!ok) return;
      audit.resetAnalysis();
    },
  });

  const providerSource = providers.providerStatus.source;

  useEffect(() => {
    // Intentional: audit as soon as a provider is available for the open sidebar
    if (isOpen && !audit.analysis && providerSource !== "none") {
      void audit.runAnalysis();
    }
  }, [isOpen, providerSource]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!openToAudit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: respond to prop change
    setActiveTab("audit");
    audit.restartAnalysis();
    onAuditOpened?.();
  }, [openToAudit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Report issue modal state
  const [isReportOpen, setIsReportOpen] = useState(false);

  const providerLabel =
    providerSource !== "none"
      ? `${
          PROVIDER_OPTIONS.find(
            (p) =>
              p.id ===
              (normalizeUiProviderId(providers.providerStatus.provider ?? "") ??
                providers.providerStatus.provider),
          )?.name ?? providers.providerStatus.provider
        } / ${providers.providerStatus.model}`
      : "No provider set";

  return (
    <>
      {isOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Dismiss assistant"
          className="fixed inset-0 z-40 bg-slate-950/60 wide:hidden cursor-pointer"
          onClick={onClose}
        />
      ) : null}
      <aside
        id="assistant-panel"
        aria-label="Assistant"
        className={cn(
          "h-full shrink-0 overflow-hidden border-l border-slate-800 bg-slate-900 transition-[width] duration-300 ease-in-out",
          isOpen ? "w-[min(100vw,420px)] wide:w-[420px]" : "w-0 border-l-0",
          "max-wide:fixed max-wide:inset-y-0 max-wide:right-0 max-wide:z-50 max-wide:shadow-2xl",
        )}
        aria-hidden={!isOpen}
        {...(!isOpen ? { inert: true } : {})}
      >
        <div className="w-[min(100vw,420px)] wide:w-[420px] h-full flex flex-col shadow-[-4px_0_24px_rgba(3,7,18,0.25)]">
          {/* Header */}
          <div className="h-12 flex items-center justify-between px-5 border-b border-slate-800 shrink-0 bg-slate-950/80">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="h-4 w-4 text-electric-blue shrink-0" />
              <span className="text-sm font-medium text-slate-100">Assistant</span>
              <span className="text-[11px] text-slate-500 truncate hidden sm:inline">· {providerLabel}</span>
            </div>
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={onClose}
              className="h-8 w-8 rounded-lg hover:bg-slate-800 border border-slate-800/55 flex items-center justify-center text-slate-400 hover:text-slate-100 transition-colors cursor-pointer shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="p-4 border-b border-slate-800/60 bg-slate-950/20 shrink-0">
            <div
              role="tablist"
              aria-label="Assistant panels"
              className="grid grid-cols-3 bg-slate-950/90 p-1 border border-slate-850 rounded-lg transform-gpu"
            >
              {TABS.map(({ id, label, Icon }) => (
                <button
                  type="button"
                  role="tab"
                  id={`assistant-tab-${id}`}
                  aria-selected={activeTab === id}
                  aria-controls={`assistant-panel-${id}`}
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
              role="tabpanel"
              id="assistant-panel-audit"
              aria-labelledby="assistant-tab-audit"
              className={cn(
                "absolute inset-0 p-4 overflow-y-auto",
                activeTab === "audit" ? "block" : "hidden",
              )}
            >
              <AuditPanel
                analysis={audit.analysis}
                isAnalyzing={audit.isAnalyzing}
                analysisError={audit.analysisError}
                onApplyAutofix={audit.applyAutofix}
                onRunAnalysis={() => void audit.runAnalysis()}
                onGoSettings={() => setActiveTab("settings")}
              />
            </div>

            {/* ── Chat ── */}
            <div
              role="tabpanel"
              id="assistant-panel-chat"
              aria-labelledby="assistant-tab-chat"
              className={cn(
                "absolute inset-0 p-4 overflow-y-auto",
                activeTab === "chat" ? "block" : "hidden",
              )}
            >
              <ChatPanel
                workspaceSummary={workspaceSummary}
                chatMessages={chat.chatMessages}
                isChatting={chat.isChatting}
                chatError={chat.chatError}
                chatEndRef={chat.chatEndRef}
                presetQueries={presetQueries}
                inputQuestion={chat.inputQuestion}
                onInputChange={chat.setInputQuestion}
                onSend={(presetText) => void chat.sendChat(presetText)}
                onGoSettings={() => setActiveTab("settings")}
                onApplyAction={handleApplyChatAction}
              />
            </div>

            {/* ── Settings ── */}
            <div
              role="tabpanel"
              id="assistant-panel-settings"
              aria-labelledby="assistant-tab-settings"
              className={cn(
                "absolute inset-0 p-4 overflow-y-auto",
                activeTab === "settings" ? "block" : "hidden",
              )}
            >
              <SettingsPanel providers={providers} local={local} isOpen={isOpen} />
            </div>
          </div>

          {/* Footer */}
          <div className="p-3.5 border-t border-slate-800 shrink-0 bg-slate-950/85 space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-slate-500 justify-center">
              <Bot className="h-3 w-3 text-slate-600" />
              <span>
                Target: <span className="text-slate-400 font-mono">{state.ihvProvider}</span>
              </span>
            </div>
            <p className="text-[10px] text-slate-600 text-center leading-snug px-1">
              AI can be wrong. Verify Audit, Chat, and Apply changes against your model, EP, and Olive docs
              before running jobs.
            </p>
            <button
              type="button"
              onClick={() => setIsReportOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-electric-blue transition-colors cursor-pointer py-1.5 rounded hover:bg-slate-800/50"
            >
              <Bug className="h-3 w-3" />
              Report an issue
            </button>
          </div>

          {/* Report Issue Modal */}
          <ReportIssueModal
            open={isReportOpen}
            onClose={() => setIsReportOpen(false)}
            state={state}
          />
        </div>
      </aside>
    </>
  );
}
