import { AlertTriangle } from "lucide-react";

/**
 * Renders an error message, distinguishing provider-configuration errors
 * (which show a "go to Settings" prompt) from generic errors.
 */
export function ProviderErrorBlock({ msg, onGoSettings }: { msg: string; onGoSettings: () => void }) {
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
}
