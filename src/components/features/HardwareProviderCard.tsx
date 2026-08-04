/**
 * Single IHV provider selection card (conflicts, install CTAs, local detection).
 * Extracted from IHVIntegrationPanel to keep that panel under CodeFactor complexity limits.
 */
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import type { OpenVinoInstallState } from "@/components/features/useOpenVinoInstall";
import {
  applyProviderConflictAutofixes,
  getProviderConflicts,
  getProviderHardwareBlock,
  prepareProviderChange,
  type HardwareConflict,
} from "@/lib/pipelineValidation";
import {
  isProviderDetectedLocally,
  type GpuInfo,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";
import type { ProviderCatalogEntry } from "@/lib/providerCatalog";
import {
  OPEN_VINO_GPU_DRIVER_URL,
  OPEN_VINO_NPU_DRIVER_URL,
} from "@/lib/openvinoDeps";
import {
  CUDA_DOWNLOAD_LINKS,
  CUDA_SM_FLOOR,
  pinnedOrtGpuInstallCommand,
} from "@/lib/cudaDeps";
import type { IHVProvider, UIState } from "@/types";
import {
  AlertTriangle,
  Wand2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  XCircle,
  Globe,
  ExternalLink,
} from "lucide-react";

export interface HardwareProviderCardProps {
  provider: ProviderCatalogEntry;
  state: UIState;
  setState: (partial: Partial<UIState>) => void;
  hardwareProbe: HardwareProbeResult | null;
  probeLoading: boolean;
  detectedProviders: IHVProvider[];
  trtRtxNeedsInstall: boolean;
  trtNeedsInstall: boolean;
  openvinoNeedsInstall: boolean;
  hardwareInstallBusy: boolean;
  installingTrtRtx: boolean;
  installTrtRtxError: string | null;
  installTrtRtxLog: string[];
  onInstallTensorRtRtx: () => void;
  installingTrt: boolean;
  installTrtError: string | null;
  installTrtLog: string[];
  onInstallTensorRt: () => void;
  openvinoInstall: {
    state: OpenVinoInstallState;
    install: () => Promise<void>;
  };
  isPreMaxwellBox: boolean;
  cudaNeedsOrtGpuInstall: boolean;
  cudaToolkitMissingAndEpWorks: boolean;
  cudaToolkitMissing: boolean;
  cudaEpInVenv: boolean;
  nvidiaGpus: GpuInfo[];
  installingOrtGpu: boolean;
  installOrtGpuError: string | null;
  installOrtGpuLog: string[];
  onInstallOrtGpu: () => void;
}

function resolveCardChrome(input: {
  isSelected: boolean;
  cardBlocked: boolean;
  cardHardwareBlocked: boolean;
  cardHasCritical: boolean;
  cardHasWarning: boolean;
  isWebGpuTarget: boolean;
  detectedLocally: boolean;
  probeLoading: boolean;
  needsPluginInstall: boolean;
}): {
  cardClasses: string;
  badgeText: string;
  BadgeIcon: typeof CheckCircle | null;
  badgeColor: string;
} {
  const base =
    "relative flex flex-col rounded-xl border p-4.5 transition-all duration-200 cursor-pointer min-w-0 max-w-full overflow-hidden ";
  const {
    isSelected,
    cardBlocked,
    cardHardwareBlocked,
    cardHasCritical,
    cardHasWarning,
    isWebGpuTarget,
    detectedLocally,
    probeLoading,
    needsPluginInstall,
  } = input;

  if (isSelected) {
    if (cardBlocked) {
      return {
        cardClasses: base + "border-rose-500 bg-rose-500/5",
        badgeText: cardHardwareBlocked ? "Unavailable hardware" : "Critical Conflict",
        BadgeIcon: XCircle,
        badgeColor: "bg-rose-500/10 text-rose-400 border-rose-550/25",
      };
    }
    if (cardHasWarning) {
      return {
        cardClasses: base + "border-amber-500 bg-amber-500/5",
        badgeText: "Warning Conflict",
        BadgeIcon: AlertTriangle,
        badgeColor: "bg-amber-500/10 text-amber-400 border-amber-550/25",
      };
    }
    return {
      cardClasses: base + "border-electric-blue bg-electric-blue/5",
      badgeText:
        !detectedLocally && !probeLoading && !isWebGpuTarget
          ? "Active (not local)"
          : isWebGpuTarget
            ? "Active (browser target)"
            : "Active Target",
      BadgeIcon: CheckCircle,
      badgeColor: "bg-electric-blue/10 text-electric-blue border-electric-blue/20",
    };
  }

  if (isWebGpuTarget) {
    return {
      cardClasses: base + "border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700",
      badgeText: "Browser deploy target",
      BadgeIcon: Globe,
      badgeColor: "bg-slate-800/80 text-slate-300 border-slate-700/60",
    };
  }
  if (cardHardwareBlocked) {
    return {
      cardClasses:
        base + "border-rose-950/35 bg-zinc-950/40 opacity-55 hover:opacity-75 hover:border-slate-700",
      badgeText: "Not on this system",
      BadgeIcon: XCircle,
      badgeColor: "bg-rose-500/5 text-rose-400/80 border-rose-550/15",
    };
  }
  if (needsPluginInstall && detectedLocally) {
    return {
      cardClasses: base + "border-amber-900/40 bg-amber-950/10 opacity-95 hover:border-amber-500/40",
      badgeText: "Plugin install needed",
      BadgeIcon: AlertTriangle,
      badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    };
  }
  if (!detectedLocally && !probeLoading) {
    return {
      cardClasses:
        base + "border-slate-850/60 bg-zinc-950/30 opacity-80 hover:opacity-100 hover:border-slate-700",
      badgeText: "Not on this system",
      BadgeIcon: AlertCircle,
      badgeColor: "bg-slate-800/80 text-slate-500 border-slate-700/60",
    };
  }
  if (cardHasCritical) {
    return {
      cardClasses:
        base + "border-rose-950/35 bg-zinc-950/40 opacity-55 hover:opacity-100 hover:border-rose-500/40",
      badgeText: "Incompatible",
      BadgeIcon: XCircle,
      badgeColor: "bg-rose-500/5 text-rose-400/80 border-rose-550/15",
    };
  }
  if (cardHasWarning) {
    return {
      cardClasses:
        base + "border-amber-950/35 bg-zinc-950/40 opacity-75 hover:opacity-100 hover:border-amber-500/40",
      badgeText: "Needs Adjust",
      BadgeIcon: AlertTriangle,
      badgeColor: "bg-amber-500/5 text-amber-400/80 border-amber-550/15",
    };
  }
  return {
    cardClasses: base + "border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700",
    badgeText: "Compatible with active passes",
    BadgeIcon: CheckCircle,
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/15",
  };
}

function hardwareDetailFor(
  providerId: IHVProvider,
  hardwareProbe: HardwareProbeResult | null,
): string | null {
  if (
    providerId === "CUDAExecutionProvider" ||
    providerId === "NvTensorRTRTXExecutionProvider" ||
    providerId === "TensorrtExecutionProvider"
  ) {
    return hardwareProbe?.nvidia?.gpus.map((g) => g.name).join(", ") ?? null;
  }
  if (providerId === "ROCMExecutionProvider") {
    return hardwareProbe?.rocm?.gpus.map((g) => g.name).join(", ") ?? null;
  }
  if (providerId === "OpenVINOExecutionProvider" && hardwareProbe?.openvino?.version) {
    const devices = hardwareProbe.openvino.devices?.length
      ? ` (${hardwareProbe.openvino.devices.join(", ")})`
      : "";
    return `OpenVINO ${hardwareProbe.openvino.version}${devices}`.trim();
  }
  if (providerId === "CPUExecutionProvider" && hardwareProbe) {
    return hardwareProbe.platform.cpuModel;
  }
  return null;
}

function selectProvider(
  providerId: IHVProvider,
  state: UIState,
  setState: (partial: Partial<UIState>) => void,
  hardwareProbe: HardwareProbeResult | null,
  detectedProviders: IHVProvider[],
  pConflicts: HardwareConflict[],
  isSelected: boolean,
): void {
  if (isSelected && pConflicts.length > 0) {
    setState({ passes: applyProviderConflictAutofixes(providerId, state.passes) });
    return;
  }
  const detected = detectedProviders.includes(providerId);
  if (!detected) {
    setState({ ihvProvider: providerId });
    return;
  }
  const patch = prepareProviderChange(state, providerId, hardwareProbe);
  if (patch) setState(patch);
}

function PluginInstallBlock({
  description,
  detail,
  busy,
  installing,
  installLabel,
  installingLabel,
  onInstall,
  error,
  log,
}: {
  description: ReactNode;
  detail?: string | null;
  busy: boolean;
  installing: boolean;
  installLabel: string;
  installingLabel: string;
  onInstall: () => void;
  error: string | null;
  log: string[];
}) {
  return (
    <div className="mt-2 space-y-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
      <p className="text-[11px] text-amber-400/90 leading-relaxed">{description}</p>
      {detail ? (
        <p className="text-[10px] text-slate-500 font-mono break-all max-w-full" title={detail}>
          {detail}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onInstall}
        className="h-7 px-3 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 text-[11px] font-bold disabled:opacity-50 flex items-center gap-1.5"
      >
        {installing ? (
          <>
            <RefreshCw className="h-3 w-3 animate-spin" />
            {installingLabel}
          </>
        ) : (
          installLabel
        )}
      </button>
      {error ? <p className="text-[11px] text-rose-400 break-all">{error}</p> : null}
      {log.length > 0 ? (
        <pre className="text-[10px] text-slate-500 max-h-24 max-w-full overflow-auto font-mono whitespace-pre-wrap break-all">
          {log.slice(-12).join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

function ProviderPluginInstalls({
  providerId,
  hardwareProbe,
  trtRtxNeedsInstall,
  trtNeedsInstall,
  openvinoNeedsInstall,
  hardwareInstallBusy,
  installingTrtRtx,
  installTrtRtxError,
  installTrtRtxLog,
  onInstallTensorRtRtx,
  installingTrt,
  installTrtError,
  installTrtLog,
  onInstallTensorRt,
  openvinoInstall,
  isPreMaxwellBox,
  cudaNeedsOrtGpuInstall,
  cudaToolkitMissingAndEpWorks,
  cudaToolkitMissing,
  cudaEpInVenv,
  nvidiaGpus,
  installingOrtGpu,
  installOrtGpuError,
  installOrtGpuLog,
  onInstallOrtGpu,
}: {
  providerId: IHVProvider;
  hardwareProbe: HardwareProbeResult | null;
  trtRtxNeedsInstall: boolean;
  trtNeedsInstall: boolean;
  openvinoNeedsInstall: boolean;
  hardwareInstallBusy: boolean;
  installingTrtRtx: boolean;
  installTrtRtxError: string | null;
  installTrtRtxLog: string[];
  onInstallTensorRtRtx: () => void;
  installingTrt: boolean;
  installTrtError: string | null;
  installTrtLog: string[];
  onInstallTensorRt: () => void;
  openvinoInstall: HardwareProviderCardProps["openvinoInstall"];
  isPreMaxwellBox: boolean;
  cudaNeedsOrtGpuInstall: boolean;
  cudaToolkitMissingAndEpWorks: boolean;
  cudaToolkitMissing: boolean;
  cudaEpInVenv: boolean;
  nvidiaGpus: GpuInfo[];
  installingOrtGpu: boolean;
  installOrtGpuError: string | null;
  installOrtGpuLog: string[];
  onInstallOrtGpu: () => void;
}) {
  if (providerId === "NvTensorRTRTXExecutionProvider" && trtRtxNeedsInstall) {
    return (
      <PluginInstallBlock
        description={
          <>
            GPU is compatible. The TensorRT RTX runtime is a separate package (not the full TensorRT
            SDK). Install into the project <code className="text-slate-400">.venv</code> to enable
            detection and runs.
          </>
        }
        detail={hardwareProbe?.tensorRtRtx?.detail}
        busy={hardwareInstallBusy}
        installing={installingTrtRtx}
        installLabel="Install tensorrt-rtx into .venv"
        installingLabel="Installing tensorrt-rtx…"
        onInstall={onInstallTensorRtRtx}
        error={installTrtRtxError}
        log={installTrtRtxLog}
      />
    );
  }
  if (providerId === "TensorrtExecutionProvider" && trtNeedsInstall) {
    return (
      <PluginInstallBlock
        description={
          <>
            GPU is compatible (Turing / GeForce RTX 20xx+). Full TensorRT needs the{" "}
            <code className="text-slate-400">nvinfer_10</code> SDK in the project{" "}
            <code className="text-slate-400">.venv</code>. Prefer TensorRT RTX for a lighter consumer
            install when that fits your recipe.
          </>
        }
        detail={hardwareProbe?.tensorrt?.detail}
        busy={hardwareInstallBusy}
        installing={installingTrt}
        installLabel="Install full TensorRT into .venv"
        installingLabel="Installing tensorrt…"
        onInstall={onInstallTensorRt}
        error={installTrtError}
        log={installTrtLog}
      />
    );
  }
  if (providerId === "OpenVINOExecutionProvider" && openvinoNeedsInstall) {
    return (
      <PluginInstallBlock
        description={
          <>
            OpenVINOExecutionProvider not ready in the project{" "}
            <code className="text-slate-400">.venv</code>. Install installs{" "}
            <code className="text-slate-400">onnxruntime-openvino</code> (replaces{" "}
            <code className="text-slate-400">onnxruntime-gpu</code> in this venv) plus OpenVINO and
            Optimum-Intel.
          </>
        }
        detail={hardwareProbe?.openvino?.detail}
        busy={hardwareInstallBusy}
        installing={openvinoInstall.state.installing}
        installLabel="Install OpenVINO stack into .venv"
        installingLabel="Installing OpenVINO stack…"
        onInstall={() => void openvinoInstall.install()}
        error={openvinoInstall.state.error}
        log={openvinoInstall.state.log}
      />
    );
  }
  if (providerId === "CUDAExecutionProvider" && isPreMaxwellBox) {
    return (
      <div className="mt-2 space-y-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
        <p className="text-[11px] text-rose-400/90 leading-relaxed">
          {nvidiaGpus.map((g) => g.name).join(", ")} predates the CUDA 12 toolkit floor (compute
          capability ≥ {CUDA_SM_FLOOR}, Maxwell / RTX 20xx+). Installing the toolkit or the CUDA
          wheel cannot recover this — these cards cannot execute modern CUDA. Use the CPU provider,
          or upgrade hardware.
        </p>
      </div>
    );
  }
  if (
    providerId === "CUDAExecutionProvider" &&
    (cudaNeedsOrtGpuInstall || cudaToolkitMissingAndEpWorks)
  ) {
    return (
      <div className="mt-2 space-y-2 min-w-0" onClick={(e) => e.stopPropagation()}>
        {cudaNeedsOrtGpuInstall ? (
          <PluginInstallBlock
            description={
              <>
                {hardwareProbe?.onnxRuntimeProviders === undefined
                  ? "Onnxruntime-gpu isn't installed in the project "
                  : "Onnxruntime-gpu CUDA execution provider is not registered in the project "}
                <code className="text-slate-400">.venv</code>. Click below to pip-install the pinned
                wheel (
                <code className="text-slate-400 font-mono break-all">{pinnedOrtGpuInstallCommand()}</code>
                ); the panel re-probes after install.
              </>
            }
            detail={hardwareProbe?.cuda?.detail}
            busy={hardwareInstallBusy}
            installing={installingOrtGpu}
            installLabel="Install onnxruntime-gpu into .venv"
            installingLabel="Installing onnxruntime-gpu…"
            onInstall={onInstallOrtGpu}
            error={installOrtGpuError}
            log={installOrtGpuLog}
          />
        ) : null}
        {cudaToolkitMissing && cudaEpInVenv ? (
          <p className="text-[11px] text-amber-500/80 leading-relaxed">
            NVIDIA driver + onnxruntime-gpu CUDA EP detected, but the CUDA Toolkit (
            <code className="text-slate-400">nvcc</code>) is not installed. Inference via OLIVE
            recipes does not need it; for native CUDA builds, grab it from{" "}
            <a
              href={CUDA_DOWNLOAD_LINKS.archive}
              target="_blank"
              rel="noopener noreferrer"
              className="text-electric-blue hover:text-white underline-offset-2 underline inline-flex items-center gap-1"
            >
              NVIDIA&apos;s CUDA Toolkit Archive
              <ExternalLink className="h-3 w-3" />
            </a>
            .
          </p>
        ) : null}
      </div>
    );
  }
  return null;
}

function OpenVinoDeviceHint({ hardwareProbe }: { hardwareProbe: HardwareProbeResult | null }) {
  const devices = hardwareProbe?.openvino?.devices ?? [];
  if (devices.length === 0 || devices.some((d) => /GPU|NPU/i.test(d))) return null;
  return (
    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
      Only CPU detected. For GPU/NPU inference, install Intel drivers:{" "}
      <a
        href={OPEN_VINO_GPU_DRIVER_URL}
        target="_blank"
        rel="noreferrer"
        className="text-electric-blue hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        GPU
      </a>
      {" / "}
      <a
        href={OPEN_VINO_NPU_DRIVER_URL}
        target="_blank"
        rel="noreferrer"
        className="text-electric-blue hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        NPU
      </a>
      .
    </p>
  );
}

function ProviderConflictAssist({
  isSelected,
  shortName,
  cardHasCritical,
  pConflicts,
  onAssist,
}: {
  isSelected: boolean;
  shortName: string;
  cardHasCritical: boolean;
  pConflicts: HardwareConflict[];
  onAssist: () => void;
}) {
  return (
    <div className="mt-3.5 pt-3.5 border-t border-slate-800/60 flex flex-col gap-2.5 animate-in fade-in duration-200">
      <p className="text-xs text-slate-500 flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
        {isSelected ? "Passes to fix on this target" : "Adjustments needed to use this target"}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pb-1">
        {pConflicts.map((c, idx) => (
          <div
            key={idx}
            className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-900 flex items-start gap-2 text-xs"
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
                c.severity === "critical" ? "bg-rose-500" : "bg-amber-400"
              }`}
            />
            <div className="leading-tight">
              <span
                className={`font-bold block text-[11px] mb-0.5 ${
                  c.severity === "critical" ? "text-rose-300" : "text-amber-400"
                }`}
              >
                {c.passName}
              </span>
              <span className="text-slate-450 text-[10.5px] font-medium leading-relaxed">{c.reason}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAssist();
          }}
          className={`text-[9.5px] uppercase tracking-wider font-extrabold px-3 py-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 ${
            cardHasCritical
              ? "border-rose-550/30 text-rose-400 bg-rose-950/20 hover:text-white hover:bg-rose-500/20"
              : "border-amber-500/30 text-amber-400 bg-amber-950/20 hover:text-white hover:bg-amber-550/20"
          }`}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {isSelected ? "Fix passes for this target" : `Switch to ${shortName} (adjusts passes)`}
        </button>
      </div>
    </div>
  );
}

export function HardwareProviderCard({
  provider: p,
  state,
  setState,
  hardwareProbe,
  probeLoading,
  detectedProviders,
  trtRtxNeedsInstall,
  trtNeedsInstall,
  openvinoNeedsInstall,
  hardwareInstallBusy,
  installingTrtRtx,
  installTrtRtxError,
  installTrtRtxLog,
  onInstallTensorRtRtx,
  installingTrt,
  installTrtError,
  installTrtLog,
  onInstallTensorRt,
  openvinoInstall,
  isPreMaxwellBox,
  cudaNeedsOrtGpuInstall,
  cudaToolkitMissingAndEpWorks,
  cudaToolkitMissing,
  cudaEpInVenv,
  nvidiaGpus,
  installingOrtGpu,
  installOrtGpuError,
  installOrtGpuLog,
  onInstallOrtGpu,
}: HardwareProviderCardProps) {
  const isSelected = state.ihvProvider === p.id;
  const Icon = p.icon;
  const pConflicts = getProviderConflicts(p.id, state.passes);
  const cardHasCritical = pConflicts.some((c) => c.severity === "critical");
  const cardHardwareBlocked =
    p.id !== "WebGpuExecutionProvider" &&
    (Boolean(getProviderHardwareBlock(p.id, hardwareProbe)) ||
      (p.id === "CPUExecutionProvider" && !hardwareProbe));
  const cardBlocked = cardHasCritical || cardHardwareBlocked;
  const cardHasWarning = pConflicts.some((c) => c.severity === "warning");
  const showSwitchAssist = pConflicts.length > 0 && (isSelected || !cardBlocked);
  const detectedLocally = isProviderDetectedLocally(p.id, hardwareProbe);
  const isWebGpuTarget = p.id === "WebGpuExecutionProvider";
  const needsPluginInstall =
    (p.id === "NvTensorRTRTXExecutionProvider" && trtRtxNeedsInstall) ||
    (p.id === "TensorrtExecutionProvider" && trtNeedsInstall) ||
    (p.id === "OpenVINOExecutionProvider" && openvinoNeedsInstall) ||
    (p.id === "CUDAExecutionProvider" && cudaNeedsOrtGpuInstall);

  const { cardClasses, badgeText, BadgeIcon, badgeColor } = resolveCardChrome({
    isSelected,
    cardBlocked,
    cardHardwareBlocked,
    cardHasCritical,
    cardHasWarning,
    isWebGpuTarget,
    detectedLocally,
    probeLoading,
    needsPluginInstall,
  });
  const hardwareDetail = hardwareDetailFor(p.id, hardwareProbe);

  const onSelect = () =>
    selectProvider(p.id, state, setState, hardwareProbe, detectedProviders, pConflicts, isSelected);

  return (
    <div onClick={onSelect} className={cardClasses}>
      <div className="flex items-start gap-4 min-w-0">
        <div
          className={`mt-0.5 shrink-0 rounded-xl p-2.5 transition-all ${
            isSelected
              ? cardHasCritical
                ? "bg-rose-500/20 text-rose-400"
                : cardHasWarning
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-electric-blue/20 text-electric-blue"
              : "bg-slate-850 text-slate-400 group-hover:text-slate-300"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-200 text-sm md:text-base leading-none">{p.name}</p>
            <span
              className={`inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider font-extrabold px-2 py-0.5 rounded border ${badgeColor}`}
            >
              {BadgeIcon ? <BadgeIcon className="h-3 w-3" aria-hidden /> : null}
              {badgeText}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-xs text-slate-400 leading-relaxed pr-6 cursor-help border-b border-dashed border-slate-700 hover:border-slate-500 transition-colors">
                {p.desc}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[360px] bg-slate-950 border border-slate-800 text-slate-300 p-4 shadow-2xl leading-relaxed z-50"
            >
              <div className="space-y-3">
                <div className="border-b border-slate-900 pb-2">
                  <p className="text-xs font-bold text-electric-blue uppercase tracking-wide">{p.name}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-slate-500 mb-1">Requirements</p>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{p.tooltip.requirements}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-slate-500 mb-1">Quantization Methods</p>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{p.tooltip.quantMethods}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-slate-500 mb-1">Recommendation</p>
                  <p className="text-[11px] text-emerald-400/90 leading-relaxed">{p.tooltip.recommendation}</p>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
          {detectedLocally && hardwareDetail ? (
            <p className="text-[11px] text-emerald-400/90 font-mono break-words">{hardwareDetail}</p>
          ) : null}
          <ProviderPluginInstalls
            providerId={p.id}
            hardwareProbe={hardwareProbe}
            trtRtxNeedsInstall={trtRtxNeedsInstall}
            trtNeedsInstall={trtNeedsInstall}
            openvinoNeedsInstall={openvinoNeedsInstall}
            hardwareInstallBusy={hardwareInstallBusy}
            installingTrtRtx={installingTrtRtx}
            installTrtRtxError={installTrtRtxError}
            installTrtRtxLog={installTrtRtxLog}
            onInstallTensorRtRtx={onInstallTensorRtRtx}
            installingTrt={installingTrt}
            installTrtError={installTrtError}
            installTrtLog={installTrtLog}
            onInstallTensorRt={onInstallTensorRt}
            openvinoInstall={openvinoInstall}
            isPreMaxwellBox={isPreMaxwellBox}
            cudaNeedsOrtGpuInstall={cudaNeedsOrtGpuInstall}
            cudaToolkitMissingAndEpWorks={cudaToolkitMissingAndEpWorks}
            cudaToolkitMissing={cudaToolkitMissing}
            cudaEpInVenv={cudaEpInVenv}
            nvidiaGpus={nvidiaGpus}
            installingOrtGpu={installingOrtGpu}
            installOrtGpuError={installOrtGpuError}
            installOrtGpuLog={installOrtGpuLog}
            onInstallOrtGpu={onInstallOrtGpu}
          />
          {p.id === "OpenVINOExecutionProvider" ? (
            <OpenVinoDeviceHint hardwareProbe={hardwareProbe} />
          ) : null}
          {isWebGpuTarget ? (
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Not a local Python EP. Select to build web-oriented recipes, then use{" "}
              <span className="text-slate-400">Recipe &amp; run → Browser Test</span> / WebGPU benchmark in
              Chrome or Edge 113+.
            </p>
          ) : null}
          {!detectedLocally && !probeLoading && !isWebGpuTarget ? (
            <p className="text-[11px] text-slate-600">
              {p.id === "CPUExecutionProvider"
                ? "Hardware detection unavailable — CPU status is unknown."
                : "No matching hardware found locally — you can still select for remote/cross-compile targets."}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-center shrink-0">
          <div
            className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? cardHasCritical
                  ? "border-rose-500 text-rose-500"
                  : cardHasWarning
                    ? "border-amber-500 text-amber-500"
                    : "border-electric-blue text-electric-blue"
                : "border-slate-700 hover:border-slate-500"
            }`}
          >
            {isSelected ? (
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  cardHasCritical ? "bg-rose-500" : cardHasWarning ? "bg-amber-500" : "bg-electric-blue"
                }`}
              />
            ) : null}
          </div>
        </div>
      </div>

      {showSwitchAssist ? (
        <ProviderConflictAssist
          isSelected={isSelected}
          shortName={p.shortName}
          cardHasCritical={cardHasCritical}
          pConflicts={pConflicts}
          onAssist={onSelect}
        />
      ) : null}

      {!isSelected && cardHasCritical && pConflicts.length > 0 ? (
        <p className="mt-3 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500 leading-relaxed">
          Incompatible with your current passes. Change passes in Optimization or select a compatible target
          above.
        </p>
      ) : null}
    </div>
  );
}
