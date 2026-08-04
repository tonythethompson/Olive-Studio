import { Check, RefreshCw } from "lucide-react";
import type { AiProviderSettings } from "./useAiProviderSettings";

interface DevinAccountPanelProps {
  providers: AiProviderSettings;
}

/** Devin sign-in + activation block shown when the Devin provider is selected. */
export function DevinAccountPanel({ providers }: DevinAccountPanelProps) {
  const { devinStatus, devinBusy, devinMessage, devinToken, isSavingProvider } = providers;
  return (
    <div className="space-y-3 p-3 rounded-xl border border-slate-800 bg-slate-950/50">
      <p className="text-[11px] text-slate-300 leading-relaxed">
        <strong className="text-slate-200">Devin subscription</strong> unlocks multiple models for Assistant
        audit and chat. Sign in with your Devin account, paste the browser token, then pick a model from
        your plan.
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
          onClick={() => void providers.handleDevinOpenSignIn()}
          className="flex-1 min-w-[8rem] h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2"
        >
          {devinBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Open Devin sign-in
        </button>
        <button
          type="button"
          disabled={devinBusy}
          onClick={() => void providers.refreshDevinAccount()}
          className="h-9 px-3 border border-slate-700 rounded-lg text-xs text-slate-300"
        >
          Refresh
        </button>
        <button
          type="button"
          disabled={devinBusy}
          onClick={() => void providers.handleDevinLogout()}
          className="h-9 px-3 border border-rose-500/30 rounded-lg text-xs text-rose-400"
        >
          Logout
        </button>
      </div>
      <div>
        <label htmlFor="gemini-settings-devin-token" className="text-xs text-slate-400 mb-1 block">
          Paste token from sign-in page
        </label>
        <input
          id="gemini-settings-devin-token"
          type="password"
          autoComplete="off"
          value={devinToken}
          onChange={(e) => providers.setDevinToken(e.target.value)}
          placeholder="Token shown after browser sign-in"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
        />
        <button
          type="button"
          disabled={devinBusy || !devinToken.trim()}
          onClick={() => void providers.handleDevinCompleteLogin()}
          className="mt-2 w-full h-9 border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10 disabled:opacity-40 rounded-lg text-xs font-bold"
        >
          Complete sign-in
        </button>
      </div>
      {devinStatus?.signedIn && (
        <button
          type="button"
          disabled={isSavingProvider}
          onClick={() => void providers.saveProvider()}
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
  );
}
