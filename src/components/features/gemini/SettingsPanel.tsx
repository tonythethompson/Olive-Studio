import { useEffect, useState } from "react";
import {
  deriveAssistantSettingsMode,
  preferredEngineFromBaseUrl,
  type AssistantSettingsMode,
} from "@/lib/assistantSettingsMode";
import { PROVIDER_OPTIONS } from "./aiProviderCatalog";
import { LocalAiSetupCard } from "./LocalAiSetupCard";
import { ManualProviderSetup } from "./ManualProviderSetup";
import type { AiProviderSettings } from "./useAiProviderSettings";
import type { LocalEngineSetup } from "./useLocalEngineSetup";

interface ActiveProviderCardProps {
  providers: AiProviderSettings;
}

/**
 * Displays the active AI provider, model, configuration source, and available actions.
 *
 * @param providers - Provider status and management actions used to populate the card
 */
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

interface SettingsModeTabsProps {
  mode: AssistantSettingsMode;
  onChange: (mode: AssistantSettingsMode) => void;
}

/**
 * Renders tabs for switching between local and cloud settings.
 *
 * @param mode - The currently selected settings mode.
 * @param onChange - Called with the selected mode when a tab is activated.
 * @returns The settings mode tab controls.
 */
function SettingsModeTabs({ mode, onChange }: SettingsModeTabsProps) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5"
      role="tablist"
      aria-label="Settings mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "local"}
        onClick={() => onChange("local")}
        className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-xs font-bold transition-all ${
          mode === "local"
            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border border-transparent text-slate-500 hover:text-slate-300"
        }`}
      >
        Local
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "cloud"}
        onClick={() => onChange("cloud")}
        className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-xs font-bold transition-all ${
          mode === "cloud"
            ? "border border-electric-blue/40 bg-electric-blue/15 text-electric-blue"
            : "border border-transparent text-slate-500 hover:text-slate-300"
        }`}
      >
        Cloud
      </button>
    </div>
  );
}

interface SettingsPanelProps {
  providers: AiProviderSettings;
  local: LocalEngineSetup;
  isOpen: boolean;
}

/**
 * Displays the active provider and configuration controls for Local and Cloud settings modes.
 *
 * @param providers - Provider state and configuration actions
 * @param local - Local provider state and engine selection actions
 * @param isOpen - Whether the settings panel is open
 */
export function SettingsPanel({ providers, local, isOpen }: SettingsPanelProps) {
  const [settingsMode, setSettingsMode] = useState<AssistantSettingsMode>(() =>
    deriveAssistantSettingsMode(providers.providerStatus.provider, providers.settingsBaseUrl),
  );

  useEffect(() => {
    const next = deriveAssistantSettingsMode(
      providers.providerStatus.provider ?? providers.settingsProvider,
      providers.settingsBaseUrl || providers.providerStatus.baseUrl,
    );
    setSettingsMode(next);
    const engine = preferredEngineFromBaseUrl(providers.settingsBaseUrl || providers.providerStatus.baseUrl);
    if (engine && engine !== local.preferredEngine) {
      local.selectPreferredEngine(engine);
    }
    // Only re-derive when the active provider identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.providerStatus.provider, providers.providerStatus.baseUrl, providers.providerStatus.source]);

  return (
    <div className="space-y-4">
      <div className="space-y-3 sticky top-0 z-10 bg-slate-950/95 pb-1 backdrop-blur-sm">
        <ActiveProviderCard providers={providers} />
        <SettingsModeTabs mode={settingsMode} onChange={setSettingsMode} />
      </div>

      {settingsMode === "local" ? (
        <LocalAiSetupCard
          local={local}
          activeModel={providers.providerStatus.model}
          isOpen={isOpen}
          onActivate={async (modelTag, source) => {
            const ok = await providers.enableLocalAiProvider(source, modelTag);
            if (!ok) return;
          }}
        />
      ) : (
        <ManualProviderSetup providers={providers} />
      )}
    </div>
  );
}
