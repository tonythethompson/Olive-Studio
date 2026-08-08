import { useEffect, useState } from "react";
import {
  deriveAssistantSettingsMode,
  preferredEngineFromBaseUrl,
  type AssistantSettingsMode,
} from "@/lib/assistantSettingsMode";
import {
  activeProviderSourceLabel,
  canClearActiveProvider,
} from "@/lib/envCredentialUi";
import { PROVIDER_OPTIONS, normalizeUiProviderId } from "./aiProviderCatalog";
import { LocalAiSetupCard } from "./LocalAiSetupCard";
import { ManualProviderSetup } from "./ManualProviderSetup";
import type { AiProviderSettings } from "./useAiProviderSettings";
import type { LocalEngineSetup } from "./useLocalEngineSetup";

interface ActiveProviderCardProps {
  providers: AiProviderSettings;
}

/**
 * Compact one-line active provider status with an optional Clear action.
 */
function ActiveProviderCard({ providers }: ActiveProviderCardProps) {
  const { providerStatus } = providers;
  const providerName =
    PROVIDER_OPTIONS.find(
      (p) => p.id === (normalizeUiProviderId(providerStatus.provider ?? "") ?? providerStatus.provider),
    )?.name ?? providerStatus.provider;
  const sourceLabel = activeProviderSourceLabel(providerStatus);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5">
      {providerStatus.source === "none" ? (
        <p className="truncate text-sm text-slate-500 italic">No provider. AI features disabled.</p>
      ) : (
        <p className="min-w-0 truncate text-sm text-slate-200">
          <span className="font-medium text-slate-100">{providerName}</span>
          <span className="text-slate-500">:</span>{" "}
          <span className="font-mono text-slate-300">{providerStatus.model}</span>
          {sourceLabel ? <span className="text-slate-500"> · {sourceLabel}</span> : null}
        </p>
      )}
      {canClearActiveProvider(providerStatus.source) ? (
        <button
          type="button"
          onClick={() => void providers.clearProvider()}
          className="shrink-0 text-[11px] text-rose-400 hover:text-rose-200 border border-rose-500/20 rounded px-2 py-0.5 font-bold transition-all cursor-pointer"
        >
          Clear
        </button>
      ) : null}
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
    <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
      <button
        type="button"
        aria-label="Local settings"
        aria-pressed={mode === "local"}
        onClick={() => onChange("local")}
        className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-bold transition-all ${
          mode === "local"
            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
            : "border border-transparent text-slate-500 hover:text-slate-300"
        }`}
      >
        Local
      </button>
      <button
        type="button"
        aria-label="Cloud settings"
        aria-pressed={mode === "cloud"}
        onClick={() => onChange("cloud")}
        className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm font-bold transition-all ${
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      {/* Pull into the scroll panel's p-4 so nothing peeks above/behind while sticky */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 space-y-3 bg-slate-950 px-4 pt-4 pb-3">
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
