import { AlertTriangle } from "lucide-react";

/** Structured error kinds from the response parser (not inferred from message text). */
export type ProviderErrorKind = "invalid_model_json";

/**
 * Renders an error block with tailored guidance for invalid model output, provider configuration issues, and other errors.
 *
 * @param msg - The error message to classify and display.
 * @param onGoSettings - Called when the user selects the Settings link for provider configuration.
 * @param kind - Optional structured error kind supplied by the response parser.
 * @returns The rendered error block.
 */
export function ProviderErrorBlock({
  msg,
  onGoSettings,
  kind,
}: {
  msg: string;
  onGoSettings: () => void;
  kind?: ProviderErrorKind;
}) {
  // Model-specific copy only when the parser supplies a structured kind.
  const isJsonModelErr = kind === "invalid_model_json";
  const isProviderErr =
    !isJsonModelErr &&
    (msg.includes("not configured") ||
      msg.includes("API key") ||
      msg.includes("No AI provider") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("API route not found"));

  if (isJsonModelErr) {
    return (
      <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-200/90 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
        <div>
          <span className="font-bold block text-amber-100">Model returned invalid JSON</span>
          <p className="mt-1 leading-relaxed text-slate-400">
            This model struggled to format the audit response. Try Analyze again, or pick a larger model in
            Settings.
          </p>
          <p className="mt-2 text-[11px] text-slate-500 font-mono break-words">{msg}</p>
        </div>
      </div>
    );
  }

  return isProviderErr ? (
    <div className="p-4 bg-slate-900 border border-slate-700 rounded-xl text-sm flex flex-col gap-2.5">
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
      <p className="text-slate-500 text-[11px]">
        Or set an env var (
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">GEMINI_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">OPENAI_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">ANTHROPIC_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">XAI_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">OPENROUTER_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">GROQ_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">OPENCODE_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">FIREWORKS_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">NVIDIA_API_KEY</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">HF_TOKEN</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">CLOUDFLARE_API_TOKEN</code>,{" "}
        <code className="bg-slate-800 px-1 rounded font-mono text-slate-300">CLOUDFLARE_ACCOUNT_ID</code>) in{" "}
        <code className="font-mono">.env</code> or <code className="font-mono">.env.local</code>, then restart{" "}
        <code className="font-mono">pnpm dev</code>.
      </p>
    </div>
  ) : (
    <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-sm text-rose-400 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
      <div>
        <span className="font-bold block text-rose-200">Error</span>
        <p className="mt-1 leading-relaxed">{msg}</p>
        <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
          If retrying fails, verify the configured endpoint in Settings.
        </p>
      </div>
    </div>
  );
}
