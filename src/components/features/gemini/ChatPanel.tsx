import type { RefObject } from "react";
import { Bot, Send } from "lucide-react";
import type { ChatAction } from "@/lib/chatActions";
import { summarizeChatPatch } from "@/lib/chatActions";
import { ProviderErrorBlock } from "../ProviderErrorBlock";
import { renderMessageContent } from "./MessageContent";
import type { ChatMessage } from "./useAiChat";

interface ChatPanelProps {
  workspaceSummary: string;
  chatMessages: readonly ChatMessage[];
  isChatting: boolean;
  chatError: string;
  chatEndRef: RefObject<HTMLDivElement | null>;
  presetQueries: readonly string[];
  inputQuestion: string;
  onInputChange: (value: string) => void;
  onSend: (presetText?: string) => void;
  onGoSettings: () => void;
  onApplyAction?: (messageIndex: number, action: ChatAction) => void;
}

/** Chat tab: live workspace summary, transcript, quick queries and composer. */
export function ChatPanel({
  workspaceSummary,
  chatMessages,
  isChatting,
  chatError,
  chatEndRef,
  presetQueries,
  inputQuestion,
  onInputChange,
  onSend,
  onGoSettings,
  onApplyAction,
}: ChatPanelProps) {
  return (
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
            {msg.actions && msg.actions.length > 0 && onApplyAction && (
              <div className="mt-2 flex flex-col gap-1.5">
                {msg.actions.map((action) => {
                  const applied = msg.appliedActionIds?.includes(action.id);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      disabled={applied}
                      title={summarizeChatPatch(action.patch)}
                      onClick={() => onApplyAction(i, action)}
                      className="text-left text-[10px] px-2 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-default cursor-pointer"
                    >
                      {applied ? "Applied" : action.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {isChatting && (
          <div className="p-3 bg-slate-900/60 border border-slate-850 rounded-lg flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-electric-blue animate-spin" />
            <span className="text-xs text-slate-400">Thinking…</span>
          </div>
        )}
        {chatError && <ProviderErrorBlock msg={chatError} onGoSettings={onGoSettings} />}
        <div ref={chatEndRef} />
      </div>

      <div className="space-y-1.5 py-1">
        <span className="text-xs text-slate-500 block">Quick queries</span>
        <div className="flex flex-wrap gap-1.5">
          {presetQueries.map((prompt, i) => (
            <button
              type="button"
              key={`${i}-${prompt.slice(0, 24)}`}
              onClick={() => onSend(prompt)}
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
          onSend();
        }}
        className="flex gap-2 pt-1.5 border-t border-slate-800/60"
      >
        <input
          aria-label="Chat message"
          placeholder="Ask about optimization, passes, hardware..."
          value={inputQuestion}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={isChatting}
          className="flex-1 min-w-0 bg-slate-950 border border-slate-800 hover:border-slate-700/80 focus:border-electric-blue/40 text-xs px-3 py-2 rounded-lg text-slate-200 focus:outline-none transition-colors"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={isChatting || !inputQuestion.trim()}
          className="h-9 w-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg flex items-center justify-center shrink-0 text-white cursor-pointer"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
