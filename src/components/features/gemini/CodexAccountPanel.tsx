import { Check, RefreshCw } from "lucide-react";
import type { AiProviderSettings } from "./useAiProviderSettings";

interface CodexAccountPanelProps {
  providers: AiProviderSettings;
}

/** Codex sign-in block shown when the Codex provider is selected. */
export function CodexAccountPanel({ providers }: CodexAccountPanelProps) {
  const { codexAccount, codexBusy, codexMessage } = providers;
  return (
    <div className="space-y-3 p-3 rounded-xl border border-slate-800 bg-slate-950/50">
      <p className="text-[11px] text-slate-300 leading-relaxed">
        Uses local <code className="text-slate-400 font-mono">codex app-server</code> for ChatGPT sign-in and{" "}
        <code className="text-slate-400 font-mono">@openai/codex-sdk</code> for recipe Q&amp;A (read-only
        sandbox). Requires the Codex CLI on PATH.
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
          onClick={() => void providers.handleCodexLogin()}
          className="flex-1 min-w-[8rem] h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2"
        >
          {codexBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Sign in with ChatGPT
        </button>
        <button
          type="button"
          disabled={codexBusy}
          onClick={() => void providers.refreshCodexAccount()}
          className="h-9 px-3 border border-slate-700 rounded-lg text-xs text-slate-300"
        >
          Refresh
        </button>
        <button
          type="button"
          disabled={codexBusy}
          onClick={() => void providers.handleCodexLogout()}
          className="h-9 px-3 border border-rose-500/30 rounded-lg text-xs text-rose-400"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
