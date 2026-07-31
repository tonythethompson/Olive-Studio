import { Download, RefreshCw } from "lucide-react";
import { LocalModelManager } from "../LocalModelManager";
import { LMS_STARTER_MODELS, OLLAMA_STARTER_MODELS, type LocalEngine } from "./aiProviderCatalog";
import type { LocalEngineSetup } from "./useLocalEngineSetup";

type StarterModel = (typeof LMS_STARTER_MODELS)[number] | (typeof OLLAMA_STARTER_MODELS)[number];

/** Format bytes to human-readable size string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** Best-effort match of a starter model tag against the engine's reported sizes. */
function resolveDisplaySize(model: StarterModel, modelSizes: Record<string, number>): string {
  const sizeBytes = Object.entries(modelSizes).find(([key]) => {
    const k = key.toLowerCase();
    const t = model.tag.toLowerCase();
    return k === t || k.includes(t.split(":")[0] ?? "") || t.includes(k.split("/").pop() ?? "___");
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
          ? "LM Studio is not running yet. Use 1-Click Download on a model — Olive Studio will install LM Studio (if needed), start the local server, and pull the model."
          : "Ollama is not running yet. Use 1-Click Download on a model — Olive Studio will install Ollama (if needed), start `ollama serve`, and pull the model."}
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
  model: StarterModel;
  displaySize: string;
  accentBg: string;
  isPulling: boolean;
  onPull: () => void;
}

function StarterModelCard({ model, displaySize, accentBg, isPulling, onPull }: StarterModelCardProps) {
  return (
    <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/60 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-xs text-slate-100">{model.name}</span>
        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded">
          {displaySize}
        </span>
      </div>
      <p className="text-[10px] text-slate-400 leading-normal">{model.desc}</p>
      <button
        type="button"
        onClick={onPull}
        disabled={isPulling}
        className={`mt-1 w-full h-7 border rounded text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${accentBg}`}
      >
        {isPulling ? (
          <>
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Pulling & Activating...</span>
          </>
        ) : (
          <>
            <Download className="h-3 w-3" />
            <span>1-Click Download & Enable</span>
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
}

function LocalPullProgress({
  pullingModel,
  localInstallInfo,
  localPullPercent,
  localPullLog,
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
        {localPullPercent !== null && (
          <span className="text-[10px] font-mono text-slate-400 shrink-0">
            {Math.round(localPullPercent)}%
          </span>
        )}
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
}

/**
 * "1-Click Local AI Setup" card: engine choice, health, starter model pulls and
 * the installed-model manager for the selected engine.
 */
export function LocalAiSetupCard({ local, activeModel, isOpen }: LocalAiSetupCardProps) {
  const isLms = local.preferredEngine === "lms";
  const accentText = isLms ? "text-electric-blue" : "text-emerald-400";
  const accentBg = isLms
    ? "bg-electric-blue/10 hover:bg-electric-blue/20 border-electric-blue/30 text-electric-blue"
    : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400";
  const healthy = isLms ? local.lmsHealthy : local.ollamaHealthy;
  const missing = isLms ? local.lmsInstalled === false : local.ollamaHealthy === false;
  const models = isLms ? LMS_STARTER_MODELS : OLLAMA_STARTER_MODELS;
  const engineName = isLms ? "LM Studio" : "Ollama";
  const showProgress = !!(local.pullingModel || local.localInstallInfo || local.localPullPercent !== null);

  return (
    <div className="p-3.5 rounded-xl border border-electric-blue/20 bg-electric-blue/5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-xs text-electric-blue">
          <Download className="h-4 w-4" />
          <span>1-Click Local AI Setup</span>
        </div>
        <span className="text-[10px] bg-electric-blue/10 text-electric-blue border border-electric-blue/30 px-1.5 py-0.5 rounded font-mono">
          Local & Private
        </span>
      </div>
      <EngineToggle preferredEngine={local.preferredEngine} onSelect={local.selectPreferredEngine} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-300 leading-relaxed">
          Download &amp; enable a local model via {isLms ? "LM Studio (Llmster CLI)" : "Ollama"} for offline
          Olive Studio AI — zero cloud keys.
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
        {models.map((m) => (
          <StarterModelCard
            key={m.tag}
            model={m}
            displaySize={resolveDisplaySize(m, local.modelSizes)}
            accentBg={accentBg}
            isPulling={local.pullingModel === m.tag}
            onPull={() => void local.pullLocalModel(m.tag, local.preferredEngine)}
          />
        ))}
      </div>

      {showProgress && (
        <LocalPullProgress
          pullingModel={local.pullingModel}
          localInstallInfo={local.localInstallInfo}
          localPullPercent={local.localPullPercent}
          localPullLog={local.localPullLog}
        />
      )}
      {local.localPullError && (
        <p className="text-xs text-rose-400 mt-1 leading-relaxed">{local.localPullError}</p>
      )}
      <LocalModelManager activeModel={activeModel} isOpen={isOpen} engine={local.preferredEngine} />
    </div>
  );
}
