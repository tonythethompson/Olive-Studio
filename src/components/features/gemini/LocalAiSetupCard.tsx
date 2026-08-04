import { Download, RefreshCw } from "lucide-react";
import { LocalModelManager } from "../LocalModelManager";
import {
  LMS_STARTER_MODELS,
  OLLAMA_STARTER_MODELS,
  findInstalledStarterId,
  type LocalEngine,
  type LocalStarterModel,
} from "./aiProviderCatalog";
import type { LocalEngineSetup } from "./useLocalEngineSetup";

/** Format bytes to human-readable size string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** Best-effort match of a starter model tag against the engine's reported sizes. */
function resolveDisplaySize(model: LocalStarterModel, modelSizes: Record<string, number>): string {
  const sizeBytes = Object.entries(modelSizes).find(([key]) => {
    const k = key.toLowerCase();
    const needles = [model.enableTag, model.match, model.tag].map((t) => t.toLowerCase());
    return needles.some(
      (t) => k === t || k.includes(t.split(":")[0] ?? "") || t.includes(k.split("/").pop() ?? "___"),
    );
  })?.[1];
  return sizeBytes ? formatBytes(sizeBytes) : model.fallbackSize;
}

interface EngineToggleProps {
  preferredEngine: LocalEngine;
  onSelect: (engine: LocalEngine) => void;
}

function EngineToggle({ preferredEngine, onSelect }: EngineToggleProps) {
  return (
    <div className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg">
      <button
        type="button"
        onClick={() => onSelect("lms")}
        className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
          preferredEngine === "lms"
            ? "bg-electric-blue/20 text-electric-blue border border-electric-blue/30"
            : "text-slate-500 hover:text-slate-300 border border-transparent"
        }`}
      >
        LM Studio
      </button>
      <button
        type="button"
        onClick={() => onSelect("ollama")}
        className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
          preferredEngine === "ollama"
            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            : "text-slate-500 hover:text-slate-300 border border-transparent"
        }`}
      >
        Ollama
      </button>
    </div>
  );
}

interface EngineMissingBannerProps {
  isLms: boolean;
  accentBg: string;
  accentText: string;
  installing: boolean;
  disabled: boolean;
  onInstall: () => void;
}

/**
 * Displays setup guidance and installation actions for an unavailable local AI engine.
 *
 * @param isLms - Whether the banner is for LM Studio rather than Ollama
 * @param installing - Whether engine installation is in progress
 * @param disabled - Whether the setup action is disabled
 * @param onInstall - Called when the setup action is selected
 */
function EngineMissingBanner({
  isLms,
  accentBg,
  accentText,
  installing,
  disabled,
  onInstall,
}: EngineMissingBannerProps) {
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 p-2.5 space-y-2">
      <p className="text-[11px] text-amber-200/90 leading-relaxed">
        {isLms
          ? "LM Studio is not running yet. Use Download & enable on a starter model. Olive Studio will install LM Studio (if needed), start the local server, and pull the model."
          : "Ollama is not running yet. Use Download & enable on a starter model. Olive Studio will install Ollama (if needed), start the Ollama app, and pull the model."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onInstall}
          className={`h-7 px-2.5 rounded text-[11px] font-bold border flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${accentBg}`}
        >
          {installing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Setup {isLms ? "LM Studio" : "Ollama"} now
        </button>
        <a
          href={isLms ? "https://lmstudio.ai" : "https://ollama.com"}
          target="_blank"
          rel="noreferrer"
          className={`text-[11px] underline ${accentText}`}
        >
          Manual install
        </a>
      </div>
    </div>
  );
}

interface StarterModelCardProps {
  model: LocalStarterModel;
  displaySize: string;
  accentBg: string;
  isPulling: boolean;
  installedId: string | null;
  onPull: () => void;
  onEnable: () => void;
}

/**
 * Renders a starter model card with its details and download action.
 *
 * @param model - The starter model to display
 * @param displaySize - The formatted model size
 * @param isPulling - Whether the model is currently being downloaded and activated
 * @param installedId - Installed engine model id when already present locally
 * @param onPull - Called when the download action is selected
 * @param onEnable - Called when enabling an already-installed starter
 */
function StarterModelCard({
  model,
  displaySize,
  accentBg,
  isPulling,
  pullBusy,
  installedId,
  onPull,
  onEnable,
}: StarterModelCardProps & { pullBusy?: boolean }) {
  const installed = Boolean(installedId);
  const disabled = isPulling || Boolean(pullBusy);
  return (
    <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/60 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-xs text-slate-100">{model.name}</span>
        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
          {displaySize}
        </span>
      </div>
      <p className="text-[10px] text-slate-400 leading-normal">{model.desc}</p>
      {installed ? (
        <p className="text-[10px] text-emerald-400/90 font-mono truncate" title={installedId ?? undefined}>
          Installed · {installedId}
        </p>
      ) : null}
      <button
        type="button"
        onClick={installed ? onEnable : onPull}
        disabled={disabled}
        className={`mt-1 w-full h-7 border rounded text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${accentBg}`}
      >
        {isPulling ? (
          <>
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Pulling & Activating...</span>
          </>
        ) : installed ? (
          <span>Enable</span>
        ) : (
          <>
            <Download className="h-3 w-3" />
            <span>Download & enable</span>
          </>
        )}
      </button>
    </div>
  );
}

interface LocalPullProgressProps {
  pullingModel: string | null;
  localInstallInfo: string | null;
  localPullPercent: number | null;
  localPullLog: readonly string[];
  onCancel: () => void;
}

function LocalPullProgress({
  pullingModel,
  localInstallInfo,
  localPullPercent,
  localPullLog,
  onCancel,
}: LocalPullProgressProps) {
  return (
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-200 leading-snug flex items-center gap-1.5 min-w-0">
          {pullingModel ? <RefreshCw className="h-3 w-3 animate-spin shrink-0 text-electric-blue" /> : null}
          <span className="truncate">
            {localInstallInfo || (pullingModel ? `Working on ${pullingModel}…` : "Ready")}
          </span>
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {localPullPercent !== null && (
            <span className="text-[10px] font-mono text-slate-400">
              {Math.round(localPullPercent)}%
            </span>
          )}
          {pullingModel ? (
            <button
              type="button"
              onClick={onCancel}
              className="text-[10px] font-semibold px-2 py-0.5 rounded border border-rose-500/35 text-rose-300 hover:bg-rose-500/10 cursor-pointer"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      {localPullPercent !== null && (
        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-electric-blue transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(2, Math.min(100, localPullPercent))}%` }}
          />
        </div>
      )}
      {localPullLog.length > 0 && (
        <div className="max-h-24 overflow-y-auto rounded border border-slate-800/80 bg-black/30 px-2 py-1.5 font-mono text-[10px] text-slate-500 space-y-0.5">
          {localPullLog.map((line, i) => (
            <div key={`${i}-${line.slice(0, 24)}`} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LocalAiSetupCardProps {
  local: LocalEngineSetup;
  /** Model currently serving audit/chat, shown by the model manager. */
  activeModel?: string;
  isOpen: boolean;
  onActivate?: (modelTag: string, source: LocalEngine) => void | Promise<void>;
}

/**
 * Displays local AI engine controls, health status, installed models, and starter downloads.
 *
 * @param local - Local AI engine state and actions
 * @param activeModel - The currently active local model
 * @param isOpen - Whether the local model manager is expanded
 * @param onActivate - Called when a model is activated
 */
export function LocalAiSetupCard({ local, activeModel, isOpen, onActivate }: LocalAiSetupCardProps) {
  const isLms = local.preferredEngine === "lms";
  const accentText = isLms ? "text-electric-blue" : "text-emerald-400";
  const accentBg = isLms
    ? "bg-electric-blue/10 hover:bg-electric-blue/20 border-electric-blue/30 text-electric-blue"
    : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400";
  const healthy = isLms ? local.lmsHealthy : local.ollamaHealthy;
  // Show setup when the engine is unreachable (not only when the CLI is missing).
  const missing = healthy === false;
  const models = isLms ? LMS_STARTER_MODELS : OLLAMA_STARTER_MODELS;
  const engineName = isLms ? "LM Studio" : "Ollama";
  const showProgress = !!(local.pullingModel || local.localInstallInfo || local.localPullPercent !== null);

  return (
    <div className="space-y-3">
      <EngineToggle preferredEngine={local.preferredEngine} onSelect={local.selectPreferredEngine} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-300 leading-relaxed">
          Offline AI via {engineName}. Models for this engine stay on this machine (separate from the other
          engine).
        </p>
        <span
          className={`inline-block w-2 h-2 shrink-0 rounded-full ${
            healthy === true ? "bg-emerald-400" : healthy === false ? "bg-rose-400" : "bg-slate-500"
          }`}
          title={
            healthy === true
              ? `${engineName} ready`
              : healthy === false
                ? `${engineName} not reachable`
                : "Checking…"
          }
        />
      </div>

      {missing && (
        <EngineMissingBanner
          isLms={isLms}
          accentBg={accentBg}
          accentText={accentText}
          installing={local.installingEngine === local.preferredEngine}
          disabled={local.installingEngine !== null}
          onInstall={() => void local.installEngine(local.preferredEngine)}
        />
      )}

      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold">
          Installed models
        </p>
        <LocalModelManager
          activeModel={activeModel}
          isOpen={isOpen}
          engine={local.preferredEngine}
          showTitle={false}
          emptyHint="No models installed for this engine yet. Use Starter downloads below."
          onActivate={async (modelTag, source) => {
            await onActivate?.(modelTag, source);
            void local.refreshInstalledModels(source);
          }}
        />
      </div>

      {showProgress && (
        <LocalPullProgress
          pullingModel={local.pullingModel}
          localInstallInfo={local.localInstallInfo}
          localPullPercent={local.localPullPercent}
          localPullLog={local.localPullLog}
          onCancel={local.cancelLocalPull}
        />
      )}
      {local.localPullError && (
        <p className="text-xs text-rose-400 mt-1 leading-relaxed">{local.localPullError}</p>
      )}

      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-extrabold pt-1">
        Starter downloads
      </p>
      <div className="space-y-2">
        {models.map((m) => {
          const installedId = findInstalledStarterId(m, local.installedModels);
          return (
            <StarterModelCard
              key={m.tag}
              model={m}
              displaySize={resolveDisplaySize(m, local.modelSizes)}
              accentBg={accentBg}
              isPulling={local.pullingModel === m.tag}
              pullBusy={Boolean(local.pullingModel)}
              installedId={installedId}
              onPull={() => void local.pullLocalModel(m.tag, local.preferredEngine)}
              onEnable={() => {
                if (!installedId || local.pullingModel) return;
                void onActivate?.(installedId, local.preferredEngine);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
