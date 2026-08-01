import { PROVIDER_OPTIONS } from "./aiProviderCatalog";
import { LocalAiSetupCard } from "./LocalAiSetupCard";
import { ManualProviderSetup } from "./ManualProviderSetup";
import type { AiProviderSettings } from "./useAiProviderSettings";
import type { LocalEngineSetup } from "./useLocalEngineSetup";

interface ActiveProviderCardProps {
  providers: AiProviderSettings;
}

function ActiveProviderCard({ providers }: ActiveProviderCardProps) {
  const { providerStatus } = providers;
  return (
    <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl">
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold mb-2">
        Active Provider
      </p>
      {providerStatus.source === "none" ? (
        <p className="text-xs text-slate-500 italic">No provider. AI features disabled.</p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-100">
              {PROVIDER_OPTIONS.find((p) => p.id === providerStatus.provider)?.name ??
                providerStatus.provider}
            </p>
            <p className="text-[10px] font-mono text-slate-400">
              {providerStatus.model} · {providerStatus.source === "env" ? "env var" : "session key"}
            </p>
          </div>
          {providerStatus.source === "user" && (
            <button
              type="button"
              onClick={() => void providers.clearProvider()}
              className="text-[10px] text-rose-400 hover:text-rose-200 border border-rose-500/20 rounded px-2 py-1 font-bold transition-all cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface SettingsPanelProps {
  providers: AiProviderSettings;
  local: LocalEngineSetup;
  isOpen: boolean;
}

/** Settings tab: active provider, 1-click local AI setup, manual provider setup. */
export function SettingsPanel({ providers, local, isOpen }: SettingsPanelProps) {
  return (
    <div className="space-y-5">
      <ActiveProviderCard providers={providers} />
      <LocalAiSetupCard local={local} activeModel={providers.providerStatus.model} isOpen={isOpen} />
      <ManualProviderSetup providers={providers} />
    </div>
  );
}
