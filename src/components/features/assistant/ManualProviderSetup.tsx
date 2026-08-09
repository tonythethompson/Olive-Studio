import { Check, Key, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { providerEnvCredential } from "@/lib/envCredentialUi";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, PROVIDER_OPTIONS, type ProviderId } from "./aiProviderCatalog";
import { CodexAccountPanel } from "./CodexAccountPanel";
import { DevinAccountPanel } from "./DevinAccountPanel";
import { ModelCombobox } from "./ModelCombobox";
import type { AiProviderSettings } from "./useAiProviderSettings";

interface ProvidersProp {
  providers: AiProviderSettings;
}

/**
 * Renders a provider selection dropdown grouped by category.
 *
 * @param providers - Provider settings and selection handler used to control the dropdown
 */
function ProviderSelect({ providers }: ProvidersProp) {
  return (
    <div>
      <label htmlFor="gemini-settings-provider" className="text-sm text-slate-400 mb-1 block">
        Provider
      </label>
      <select
        id="gemini-settings-provider"
        aria-label="AI provider"
        value={providers.settingsProvider}
        onChange={(e) => providers.selectProvider(e.target.value as ProviderId)}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
      >
        {PROVIDER_OPTIONS.reduce<ReactNode[]>((acc, p, i) => {
          const prev = i > 0 ? PROVIDER_OPTIONS[i - 1] : null;
          if (!prev || prev.category !== p.category) {
            acc.push(
              <option key={`cat-${p.category}`} value="" disabled className="text-slate-500 font-bold">
                ── {CATEGORY_LABELS[p.category] ?? p.category} ──
              </option>,
            );
          }
          acc.push(
            <option key={p.id} value={p.id}>
              {p.name}
            </option>,
          );
          return acc;
        }, [])}
      </select>
    </div>
  );
}

/** "Live catalog" / "Defaults" badge plus the manual refresh button. */
function ModelSourceBadge({ providers }: ProvidersProp) {
  const { modelsLoading, modelsSource } = providers;
  return (
    <div className="flex items-center gap-2">
      {modelsLoading ? (
        <span className="text-[11px] text-slate-500 flex items-center gap-1">
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
          Refreshing…
        </span>
      ) : modelsSource === "live" ? (
        <span className="text-[11px] text-emerald-500/80">Live catalog</span>
      ) : modelsSource === "fallback" ? (
        <span className="text-[11px] text-slate-500">Defaults</span>
      ) : null}
      <button
        type="button"
        title="Refresh model list from provider"
        disabled={modelsLoading}
        onClick={() => providers.refreshModels()}
        className="text-[11px] text-slate-400 hover:text-electric-blue disabled:opacity-40 flex items-center gap-0.5"
      >
        <RefreshCw className={cn("h-2.5 w-2.5", modelsLoading && "animate-spin")} />
        Refresh
      </button>
    </div>
  );
}

/** Model input: free text for openai-compat, combobox for routers, list otherwise. */
function ModelInput({ providers }: ProvidersProp) {
  const {
    isCompatMode,
    settingsProvider,
    displayedModels,
    customModel,
    settingsModel,
    modelsSource,
    modelsLoading,
  } = providers;

  if (isCompatMode && settingsProvider === "openai-compat") {
    return (
      <input
        id="gemini-settings-model"
        aria-label="Custom model name"
        placeholder="Model name (e.g. llama3.1:8b, deepseek-r1)"
        value={customModel}
        onChange={(e) => providers.setCustomModel(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
      />
    );
  }

  if (isCompatMode && displayedModels.length > 0) {
    const selected = customModel || settingsModel;
    return (
      <ModelCombobox
        id="gemini-settings-model"
        value={selected}
        options={displayedModels}
        modelsSource={modelsSource}
        modelsLoading={modelsLoading}
        onChange={(modelId) => {
          providers.setCustomModel(modelId);
          providers.setSettingsModel(modelId);
        }}
      />
    );
  }

  return (
    <select
      id="gemini-settings-model"
      aria-label="AI model"
      value={settingsModel}
      onChange={(e) => providers.setSettingsModel(e.target.value)}
      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue cursor-pointer"
    >
      {displayedModels.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

function ModelField({ providers }: ProvidersProp) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label htmlFor="gemini-settings-model" className="text-sm text-slate-400 block">
          Model
        </label>
        <ModelSourceBadge providers={providers} />
      </div>
      <ModelInput providers={providers} />
      {providers.modelsHint && (
        <p className="mt-1 text-[11px] text-slate-500 leading-snug">{providers.modelsHint}</p>
      )}
    </div>
  );
}

/**
 * Renders provider connection fields and a button to save and activate the provider.
 *
 * @param providers - Provider settings, state, and actions used by the form
 */
function ApiKeyForm({ providers }: ProvidersProp) {
  const {
    isCompatMode,
    providerOption,
    providerStatus,
    settingsProvider,
    settingsBaseUrl,
    settingsApiKey,
    settingsCloudflareAccountId,
    isSavingProvider,
  } = providers;
  const envCred = providerEnvCredential(providerStatus.envCredentials, settingsProvider);
  const envUsable = Boolean(envCred?.usable && envCred.envVar);
  const envPresentOnly = Boolean(envCred?.present && envCred.envVar && !envCred.usable);
  const keyPlaceholder = envUsable
    ? `Leave blank to use ${envCred!.envVar}`
    : "Stored in memory only, never persisted to disk";

  return (
    <>
      {isCompatMode && (
        <div>
          <label htmlFor="gemini-settings-base-url" className="text-sm text-slate-400 mb-1 block">
            Base URL
          </label>
          <input
            id="gemini-settings-base-url"
            type="text"
            placeholder="http://localhost:11434/v1"
            value={settingsBaseUrl}
            onChange={(e) => providers.setSettingsBaseUrl(e.target.value)}
            onBlur={() => providers.refreshModelsForTypedBaseUrl()}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
          />
          <p className="text-[11px] text-slate-600 mt-1">
            For OpenAI-compatible cloud or self-hosted endpoints (vLLM, SGLang, custom gateways). Local LM
            Studio / Ollama live under the Local tab.
          </p>
        </div>
      )}

      <div>
        <label
          htmlFor="gemini-settings-api-key"
          className="text-sm text-slate-400 mb-1 flex flex-wrap items-center gap-1.5"
        >
          <Key className="h-3 w-3" />
          API Key
          {envUsable && !settingsApiKey.trim() ? (
            <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-semibold">
              Env available: {envCred!.envVar}
            </span>
          ) : envPresentOnly ? (
            <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono font-semibold">
              Found {envCred!.envVar} (incomplete)
            </span>
          ) : "keyEnvVar" in providerOption && providerOption.keyEnvVar ? (
            <span className="text-[9px] text-slate-600">
              (or env: <code className="font-mono">{providerOption.keyEnvVar}</code>)
            </span>
          ) : null}
        </label>
        <input
          id="gemini-settings-api-key"
          type="password"
          autoComplete="off"
          placeholder={keyPlaceholder}
          value={settingsApiKey}
          onChange={(e) => providers.setSettingsApiKey(e.target.value)}
          onBlur={() => providers.refreshModelsForTypedApiKey()}
          onKeyDown={(e) => e.key === "Enter" && void providers.saveProvider()}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
        />
      </div>

      {settingsProvider === "cloudflare" && (
        <div>
          <label className="text-sm text-slate-400 mb-1 block" htmlFor="gemini-cf-account-id">
            Cloudflare Account ID
          </label>
          <input
            id="gemini-cf-account-id"
            type="text"
            autoComplete="off"
            placeholder="32-char hex CLOUDFLARE_ACCOUNT_ID"
            value={settingsCloudflareAccountId}
            onChange={(e) => providers.setSettingsCloudflareAccountId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void providers.saveProvider()}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
          />
          <p className="text-[11px] text-slate-600 mt-1">
            Required with the API token. Workers AI is account-scoped.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void providers.saveProvider()}
        disabled={isSavingProvider}
        className="w-full h-9 bg-electric-blue hover:bg-electric-blue/90 disabled:opacity-40 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2 transition-all cursor-pointer"
      >
        {isSavingProvider ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Save & Activate
      </button>
    </>
  );
}

/**
 * Configures a cloud provider, model, and provider authentication details.
 *
 * @param providers - Provider options and state used by the setup controls
 */
export function ManualProviderSetup({ providers }: ProvidersProp) {
  const { settingsProvider, providerOption, providerSaveError } = providers;
  return (
    <div className="space-y-3">
      <ProviderSelect providers={providers} />
      <ModelField providers={providers} />

      {settingsProvider === "codex" ? (
        <CodexAccountPanel providers={providers} />
      ) : settingsProvider === "devin" ? (
        <DevinAccountPanel providers={providers} />
      ) : (
        <ApiKeyForm providers={providers} />
      )}

      {providerSaveError && <p className="text-sm text-rose-400">{providerSaveError}</p>}

      {"docsUrl" in providerOption && providerOption.docsUrl && (
        <p className="text-[11px] text-slate-600 text-center">
          Docs: <span className="font-mono text-slate-500">{providerOption.docsUrl}</span>
        </p>
      )}
    </div>
  );
}
