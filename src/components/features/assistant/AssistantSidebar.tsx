import { useState, useEffect, useMemo, useTransition, useRef, useCallback } from "react";
import { UIState } from "@/types";
import type { AskAiChatDetail } from "@/lib/aiChatBridge";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { cn } from "@/lib/utils";
import {
  buildAiWorkspaceContext,
  buildChatPresetQueries,
  buildWorkspaceContextSummary,
} from "@/lib/aiWorkspaceContext";
import {
  chatPatchToUiState,
  sanitizeChatActionPatch,
  stripGatedFields,
  confirmGatedPatchFields,
  type ChatAction,
} from "@/lib/chatActions";
import { Bot, X, MessageSquareCode, Settings2, Shield, Bug } from "lucide-react";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { PipelineReview } from "./PipelineReview";
import { ReportIssueModal } from "@/components/ReportIssueModal";
import { PROVIDER_OPTIONS, normalizeUiProviderId } from "./aiProviderCatalog";
import { ChatPanel } from "./ChatPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { SidebarTab } from "./types";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";
import { useAiChat } from "./useAiChat";
import { useAiProviderSettings } from "./useAiProviderSettings";
import { useLocalEngineSetup } from "./useLocalEngineSetup";
import { AgentAccessControls } from "@/components/features/AgentAccessControls";

export type { AnalysisResult, Suggestion } from "./types";

type PendingReviewKick =
  | { kind: "refresh"; resetFirst?: boolean }
  | { kind: "reset" };
interface AssistantSidebarProps {
  state?: UIState;
  setState?: (partial: Partial<UIState>) => void;
  isOpen: boolean;
  onClose: () => void;
  openToAudit?: boolean;
  onAuditOpened?: () => void;
  pendingChatQuery?: AskAiChatDetail | null;
  onChatQueryConsumed?: () => void;
}

const TABS = [
  { id: "assistant" as const, label: "Assistant", Icon: MessageSquareCode },
  { id: "settings" as const, label: "Settings", Icon: Settings2 },
  { id: "agent" as const, label: "Agent", Icon: Shield },
];

/**
 * Renders a sidebar for pipeline auditing, workspace-aware chat, and AI provider configuration.
 *
 * @param propState - Optional pipeline state override (`state`); defaults to the pipeline store
 * @param propSetState - Optional state update handler (`setState`); defaults to the pipeline store
 * @param isOpen - Whether the sidebar is visible
 * @param onClose - Callback invoked when the sidebar is closed
 * @param openToAudit - Whether to select the audit tab and restart analysis
 * @param onAuditOpened - Optional callback invoked after the audit tab is opened
 * @param pendingChatQuery - A query to select the chat tab and send automatically
 * @param onChatQueryConsumed - Optional callback invoked after the pending chat query is sent
 */
export function AssistantSidebar({
  state: propState,
  setState: propSetState,
  isOpen,
  onClose,
  openToAudit,
  onAuditOpened,
  pendingChatQuery,
  onChatQueryConsumed,
}: AssistantSidebarProps) {
  const storeState = usePipelineState();
  const state = propState ?? storeState.state;
  const setState = propSetState ?? storeState.setState;
  const persistedActiveTab = usePreferencesStore((s) => s.assistantActiveTab);
  const setPersistedActiveTab = usePreferencesStore((s) => s.setAssistantActiveTab);
  const activeTab: SidebarTab = useMemo(
    () => (TABS.some((tab) => tab.id === persistedActiveTab) ? persistedActiveTab : "assistant"),
    [persistedActiveTab],
  );
  const setActiveTab = useCallback((tab: SidebarTab) => {
    setPersistedActiveTab(tab);
  }, [setPersistedActiveTab]);
  const [, startTabTransition] = useTransition();
  const { data: hardwareProbe = null } = useHardwareProbe({ enabled: isOpen });

  const handleTabChange = (tab: SidebarTab) => {
    startTabTransition(() => {
      setActiveTab(tab);
    });
  };

  const workspaceContext = useMemo(() => buildAiWorkspaceContext(state), [state]);
  const presetQueries = useMemo(() => buildChatPresetQueries(state), [state]);
  const workspaceSummary = useMemo(() => buildWorkspaceContextSummary(workspaceContext), [workspaceContext]);

  const chat = useAiChat(workspaceContext);
  // Ref to trigger post-patch refresh in PipelineReview from chat actions.
  const postPatchRefreshRef = useRef<(() => void) | null>(null);
  const reviewRefreshRef = useRef<((options?: { resetFirst?: boolean }) => void) | null>(null);
  const reviewResetRef = useRef<(() => void) | null>(null);
  /** Queued when parent kicks review before PipelineReview has wired the refs. */
  const pendingReviewKickRef = useRef<PendingReviewKick | null>(null);

  const requestReviewRefresh = useCallback((options?: { resetFirst?: boolean }) => {
    if (options?.resetFirst) {
      reviewResetRef.current?.();
    }
    if (reviewRefreshRef.current) {
      reviewRefreshRef.current(options);
      pendingReviewKickRef.current = null;
      return;
    }
    pendingReviewKickRef.current = { kind: "refresh", resetFirst: options?.resetFirst };
  }, []);

  const requestReviewReset = useCallback(() => {
    if (reviewResetRef.current) {
      reviewResetRef.current();
      pendingReviewKickRef.current = null;
      return;
    }
    pendingReviewKickRef.current = { kind: "reset" };
  }, []);

  const flushPendingReviewKick = useCallback(() => {
    const pending = pendingReviewKickRef.current;
    if (!pending) return;
    pendingReviewKickRef.current = null;
    if (pending.kind === "reset") {
      reviewResetRef.current?.();
      return;
    }
    if (pending.resetFirst) {
      reviewResetRef.current?.();
    }
    reviewRefreshRef.current?.(pending.resetFirst ? { resetFirst: true } : undefined);
  }, []);

  const chatLogForReport = useMemo(() => {
    return chat.chatMessages.map((m) => {
      // Normalize message text to keep one "sender: text" line per turn
      const maxLength = 500;
      const normalized = m.text.replace(/\s+/g, " ").trim();

      const text = normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;

      return `${m.sender}: ${text}`;
    });
  }, [chat.chatMessages]);

  const handleApplyChatAction = (messageIndex: number, action: ChatAction) => {
    const patch = sanitizeChatActionPatch(action.patch);
    if (!patch) return;
    const confirmGated = confirmGatedPatchFields(patch);
    const appliedPatch = confirmGated ? patch : stripGatedFields(patch);
    const partial = chatPatchToUiState(state, appliedPatch, { confirmGated });
    setState(partial);
    chat.markActionApplied(messageIndex, action.id);
    // Route post-patch refresh through PipelineReview's schedulePostPatchRefresh.
    postPatchRefreshRef.current?.();
  };

  const providers = useAiProviderSettings({
    isOpen,
    activeTab,
    onProviderActivated: () => {
      setActiveTab("assistant");
      requestReviewRefresh({ resetFirst: true });
    },
    onProviderMissing: () => setActiveTab("settings"),
    onProviderCleared: () => {
      setActiveTab("settings");
      requestReviewReset();
    },
  });

  const local = useLocalEngineSetup({
    isOpen,
    onModelActivated: async (modelTag, source, signal) => {
      const ok = await providers.enableLocalAiProvider(source, modelTag, signal);
      if (!ok || signal?.aborted) return;
    },
  });

  const providerSource = providers.providerStatus.source;
  const prevProviderSourceRef = useRef(providerSource);

  useEffect(() => {
    if (!isOpen) return;
    const providerChanged = prevProviderSourceRef.current !== providerSource;
    prevProviderSourceRef.current = providerSource;

    if (providerSource !== "none") {
      if (providerChanged) {
        requestReviewRefresh({ resetFirst: true });
      } else {
        requestReviewRefresh();
      }
    } else {
      requestReviewReset();
    }
  }, [isOpen, providerSource, requestReviewRefresh, requestReviewReset]);

  useEffect(() => {
    if (!openToAudit) return;
    setActiveTab("assistant");
    requestReviewRefresh({ resetFirst: true });
    onAuditOpened?.();
  }, [openToAudit, requestReviewRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pendingChatQuery) return;
    setActiveTab("assistant");
    void chat.sendChat(pendingChatQuery.query);
    onChatQueryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per nonce, not on every chat/audit identity change
  }, [pendingChatQuery]);

  // Report issue modal state (must precede the Escape-key effect that reads it)
  const [isReportOpen, setIsReportOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isReportOpen) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isReportOpen, onClose]);

  const normalizedProviderId =
    normalizeUiProviderId(providers.providerStatus.provider ?? "") ?? providers.providerStatus.provider;
  const devinMatch =
    normalizedProviderId === "devin"
      ? providers.devinModels.find((m) => m.id === providers.providerStatus.model)
      : undefined;
  const modelName = devinMatch ? devinMatch.name : providers.providerStatus.model;

  const providerLabel =
    providerSource !== "none"
      ? `${PROVIDER_OPTIONS.find((p) => p.id === normalizedProviderId)?.name ?? providers.providerStatus.provider} / ${modelName}`
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
          isOpen ? "w-full wide:w-[420px]" : "w-0 border-l-0",
          "max-wide:fixed max-wide:inset-y-0 max-wide:right-0 max-wide:z-50 max-wide:shadow-2xl",
        )}
        aria-hidden={!isOpen}
        {...(!isOpen ? { inert: true } : {})}
      >
        <div className="w-full wide:w-[420px] h-full flex flex-col shadow-[-4px_0_24px_rgba(3,7,18,0.25)]">
          {/* Header */}
          <div className="h-12 flex items-center justify-between px-4 border-b border-slate-800 shrink-0 bg-slate-950/80">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="h-4 w-4 text-electric-blue shrink-0" />
              <span className="text-sm font-medium text-slate-100">Assistant</span>
              <span className="text-xs text-slate-400 font-mono truncate max-w-[140px]" title={state.ihvProvider}>
                [{state.ihvProvider.replace("ExecutionProvider", "")}]
              </span>
              <span className="text-xs text-slate-500 truncate hidden sm:inline">· {providerLabel}</span>
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
                  aria-label={label}
                  aria-selected={activeTab === id}
                  aria-controls={`assistant-panel-${id}`}
                  key={id}
                  onClick={() => handleTabChange(id)}
                  className={`py-1.5 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer border ${activeTab === id ? "bg-slate-900 text-electric-blue shadow-sm border-slate-800/40" : "text-slate-400 hover:text-slate-200 border-transparent"}`}
                >
                  <Icon
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 ${activeTab === id ? "text-electric-blue" : "text-slate-500"}`}
                  />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden relative transform-gpu">
            {/* ── Assistant (Unified: PipelineReview + Chat) ── */}
            <div
              role="tabpanel"
              id="assistant-panel-assistant"
              aria-labelledby="assistant-tab-assistant"
              className={cn(
                "absolute inset-0 flex flex-col overflow-y-auto",
                activeTab === "assistant" ? "flex" : "hidden",
              )}
              aria-hidden={activeTab !== "assistant"}
            >
              {/* PipelineReview at the top (Req 1.2) */}
              <PipelineReview
                state={state}
                setState={setState}
                onExplain={(body) => void chat.sendChat(body)}
                className="m-4 mb-0 shrink-0"
                postPatchRefreshRef={postPatchRefreshRef}
                reviewRefreshRef={reviewRefreshRef}
                reviewResetRef={reviewResetRef}
                onReviewApiReady={flushPendingReviewKick}
              />

              {/* Chat conversation below (Req 1.5) */}
              <div className="flex-1 p-4">
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

            {/* ── Agent ── */}
            <div
              role="tabpanel"
              id="assistant-panel-agent"
              aria-labelledby="assistant-tab-agent"
              className={cn(
                "absolute inset-0 p-4 overflow-y-auto",
                activeTab === "agent" ? "block" : "hidden",
              )}
            >
              <AgentAccessControls variant="panel" isOpen={isOpen} />
            </div>
          </div>

          {/* Footer */}
          <div className="px-3.5 py-2 border-t border-slate-800 shrink-0 bg-slate-950/85 flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-500 truncate leading-tight flex-1" title="AI can make mistakes. Verify Audit, Chat, and Apply changes before running jobs.">
              Verify AI changes against your model & EP before running.
            </p>
            <button
              type="button"
              onClick={() => setIsReportOpen(true)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-electric-blue transition-colors cursor-pointer py-1 px-2 rounded hover:bg-slate-800 shrink-0 font-medium"
            >
              <Bug className="h-3 w-3" />
              <span>Feedback</span>
            </button>
          </div>

          {/* Report Issue Modal */}
          <ReportIssueModal
            open={isReportOpen}
            onClose={() => setIsReportOpen(false)}
            state={state}
            hardwareProbe={hardwareProbe}
            chatLog={chatLogForReport}
            defaultArea="assistant-ai"
          />
        </div>
      </aside>
    </>
  );
}
