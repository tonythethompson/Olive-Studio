import { useState, useEffect, useMemo, useTransition, useRef } from "react";
import { UIState } from "@/types";
import type { AskAiChatDetail } from "@/lib/aiChatBridge";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { cn } from "@/lib/utils";
import {
  buildAiWorkspaceContext,
  buildChatPresetQueries,
  buildWorkspaceContextSummary,
} from "@/lib/aiWorkspaceContext";
import { chatPatchToUiState, sanitizeChatActionPatch, type ChatAction } from "@/lib/chatActions";
import { Bot, X, MessageSquareCode, Settings2, Bug } from "lucide-react";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { PipelineReview } from "./PipelineReview";
import { ReportIssueModal } from "@/components/ReportIssueModal";
import { PROVIDER_OPTIONS, normalizeUiProviderId } from "./aiProviderCatalog";
import { ChatPanel } from "./ChatPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { SidebarTab } from "./types";
import { useAiChat } from "./useAiChat";
import { useAiProviderSettings } from "./useAiProviderSettings";
import { useLocalEngineSetup } from "./useLocalEngineSetup";

export type { AnalysisResult, Suggestion } from "./types";

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
];

/**
 * Renders a sidebar for pipeline auditing, workspace-aware chat, and AI provider configuration.
 *
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
  const [activeTab, setActiveTab] = useState<SidebarTab>("assistant");
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
  const reviewRefreshRef = useRef<(() => void) | null>(null);
  const reviewResetRef = useRef<(() => void) | null>(null);
  const chatLogForReport = useMemo(
    () =>
      chat.chatMessages.map((m) => {
        // Normalize message text to keep one "sender: text" line per turn
        // 1. Replace newlines with spaces
        // 2. Collapse multiple whitespace characters
        // 3. Trim leading/trailing whitespace
        // 4. Optionally truncate to a reasonable maximum length
        const maxLength = 500;
        const normalized = m.text
          .replace(/\s*\n\s*/g, " ") // replace newlines (and surrounding spaces) with a single space
          .replace(/\s+/g, " ") // collapse multiple whitespace into a single space
          .trim();

        const text =
          normalized.length > maxLength
            ? `${normalized.slice(0, maxLength)}…`
            : normalized;

        return `${m.sender}: ${text}`;
      }),
    [chat.chatMessages],
  );

  const handleApplyChatAction = (messageIndex: number, action: ChatAction) => {
    const patch = sanitizeChatActionPatch(action.patch);
    if (!patch) return;
    const partial = chatPatchToUiState(state, patch);
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
      reviewRefreshRef.current?.();
    },
    onProviderMissing: () => setActiveTab("settings"),
    onProviderCleared: () => {
      setActiveTab("settings");
      reviewResetRef.current?.();
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

  useEffect(() => {
    if (isOpen && providerSource !== "none") {
      reviewRefreshRef.current?.();
    }
  }, [isOpen, providerSource]);

  useEffect(() => {
    if (!openToAudit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: respond to prop change
    setActiveTab("assistant");
    reviewRefreshRef.current?.();
    onAuditOpened?.();
  }, [openToAudit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pendingChatQuery) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: respond to prop change
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

  const providerLabel =
    providerSource !== "none"
      ? `${PROVIDER_OPTIONS.find(
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
          isOpen ? "w-full wide:w-[420px]" : "w-0 border-l-0",
          "max-wide:fixed max-wide:inset-y-0 max-wide:right-0 max-wide:z-50 max-wide:shadow-2xl",
        )}
        aria-hidden={!isOpen}
        {...(!isOpen ? { inert: true } : {})}
      >
        <div className="w-full wide:w-[420px] h-full flex flex-col shadow-[-4px_0_24px_rgba(3,7,18,0.25)]">
          {/* Header */}
          <div className="h-12 flex items-center justify-between px-5 border-b border-slate-800 shrink-0 bg-slate-950/80">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="h-4 w-4 text-electric-blue shrink-0" />
              <span className="text-sm font-medium text-slate-100">Assistant</span>
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
              className="grid grid-cols-2 bg-slate-950/90 p-1 border border-slate-850 rounded-lg transform-gpu"
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
          </div>

          {/* Footer */}
          <div className="p-3.5 border-t border-slate-800 shrink-0 bg-slate-950/85 space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 justify-center">
              <Bot className="h-3 w-3 text-slate-600" />
              <span>
                Target: <span className="text-slate-400 font-mono">{state.ihvProvider}</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-600 text-center leading-snug px-1">
              AI can be wrong. Verify Audit, Chat, and Apply changes against your model, EP, and Olive docs
              before running jobs.
            </p>
            <button
              type="button"
              onClick={() => setIsReportOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-electric-blue transition-colors cursor-pointer py-1.5 rounded hover:bg-slate-800/50"
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
            hardwareProbe={hardwareProbe}
            chatLog={chatLogForReport}
            defaultArea="assistant-ai"
          />
        </div>
      </aside>
    </>
  );
}
