/**
 * Single IHV provider selection card (conflicts, install CTAs, local detection).
 * Extracted from IHVIntegrationPanel to keep that panel under CodeFactor complexity limits.
 */
import { memo, useState, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import type { OpenVinoInstallState } from "@/components/features/ihv/useOpenVinoInstall";
import type { DirectMlInstallState } from "@/components/features/ihv/useDirectMlInstall";
import type { QnnInstallState } from "@/components/features/ihv/useQnnInstall";
import {
  QNN_ADVANCED_QAIRT_DOCS_URL,
  isQnnSnapdragonReleaseGatePassed,
} from "@/lib/qnnDeps";
import { qnnRuntimeUiLabel } from "@/lib/qnnReadiness";
import {
  applyProviderConflictAutofixes,
  getProviderConflicts,
  getProviderHardwareBlock,
  prepareProviderChange,
  type HardwareConflict,
} from "@/lib/pipelineValidation";
import {
  isProviderDetectedLocally,
  computeDirectMlHardwareReady,
  computeOpenVinoCompatibleHardware,
  type GpuInfo,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";
import type { ProviderCatalogEntry } from "@/lib/providerCatalog";
import {
  isExportTargetProvider,
  isLegacyExportProvider,
  isPlatformLocalProvider,
} from "@/lib/providerRuntimeKind";
import {
  OPEN_VINO_GPU_DRIVER_URL,
  OPEN_VINO_NPU_DRIVER_URL,
  pickOpenVinoTargetFromDevices,
} from "@/lib/openvinoDeps";
import {
  CUDA_DOWNLOAD_LINKS,
  CUDA_SM_FLOOR,
  pinnedOrtGpuInstallCommand,
} from "@/lib/cudaDeps";
import { rocmDownloadUrlForOs } from "@/lib/rocmDeps";
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
  ChevronDown,
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
  qnnInstall: {
    state: QnnInstallState;
    install: () => Promise<void>;
    testNpu: () => Promise<void>;
  };
  directMlInstall: {
    state: DirectMlInstallState;
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
  /** WebGPU keeps the historical “Browser deploy target” badge copy. */
  isWebGpuTarget: boolean;
  isExportTarget: boolean;
  isLegacyTarget: boolean;
  isPlatformTarget: boolean;
  detectedLocally: boolean;
  probeLoading: boolean;
  needsPluginInstall: boolean;
}): {
  cardClasses: string;
  badgeText: string;
  BadgeIcon: typeof CheckCircle | null;
  badgeColor: string;
  badgeIconColor?: string;
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
    isExportTarget,
    isLegacyTarget,
    isPlatformTarget,
    detectedLocally,
    probeLoading,
    needsPluginInstall,
  } = input;

  const softTarget = isExportTarget || isPlatformTarget;

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
        !detectedLocally && !probeLoading && !softTarget
          ? "Active (not local)"
          : isWebGpuTarget
            ? "Active (browser target)"
            : isLegacyTarget
              ? "Active (legacy export)"
              : isExportTarget
                ? "Active (export target)"
                : isPlatformTarget
                  ? "Active (platform)"
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
  if (isLegacyTarget) {
    return {
      cardClasses: base + "border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700",
      badgeText: "Legacy export",
      BadgeIcon: Globe,
      badgeColor: "bg-amber-500/10 text-amber-400/90 border-amber-500/20",
    };
  }
  if (isExportTarget) {
    return {
      cardClasses: base + "border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700",
      badgeText: "Export target",
      BadgeIcon: Globe,
      badgeColor: "bg-slate-800/80 text-slate-300 border-slate-700/60",
    };
  }
  if (isPlatformTarget) {
    return {
      cardClasses: base + "border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700",
      badgeText: detectedLocally ? "Platform (local)" : "Platform",
      BadgeIcon: detectedLocally ? CheckCircle : Globe,
      badgeColor: detectedLocally
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        : "bg-slate-800/80 text-slate-300 border-slate-700/60",
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
      cardClasses: base + "border-emerald-900/40 bg-emerald-950/10 opacity-95 hover:border-emerald-500/40",
      badgeText: "Compatible, runtime available",
      BadgeIcon: CheckCircle,
      badgeColor: "bg-slate-800/60 text-slate-300 border-slate-700/60",
      badgeIconColor: "text-emerald-400",
    };
  }
  if (needsPluginInstall && !detectedLocally && !probeLoading) {
    return {
      cardClasses: base + "border-slate-800/80 bg-slate-900/40 opacity-90 hover:opacity-100 hover:border-slate-700",
      badgeText: "Pre-install available",
      BadgeIcon: AlertCircle,
      badgeColor: "bg-slate-800/80 text-slate-400 border-slate-700/60",
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
    badgeColor: "bg-slate-800/60 text-slate-300 border-slate-700/60",
    badgeIconColor: "text-emerald-400",
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
  if (providerId === "QNNExecutionProvider" && hardwareProbe) {
    const label = qnnRuntimeUiLabel(hardwareProbe);
    const ver = hardwareProbe.qnn?.pluginVersion ? ` · plugin ${hardwareProbe.qnn.pluginVersion}` : "";
    return `${label}${ver}`;
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
    setState({
      ihvProvider: providerId,
      ...(providerId === "OpenVINOExecutionProvider"
        ? {
          openvinoTargetDevice: pickOpenVinoTargetFromDevices(hardwareProbe?.openvino?.devices),
        }
        : {}),
    });
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
  variant = "compatible",
  isExpanded,
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
  /** "compatible" = green (hardware present), "cross-compile" = neutral (no local hardware). */
  variant?: "compatible" | "cross-compile";
  /** Explanatory copy stays collapsed by default; the install action itself never does. */
  isExpanded: boolean;
}) {
  const isGreen = variant === "compatible";
  return (
    <div className="mt-2 space-y-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
      {isExpanded && (
        <p className={cn("text-xs leading-relaxed", isGreen ? "text-emerald-400/90" : "text-slate-400")}>
          {description}
        </p>
      )}
      {isExpanded && detail ? (
        <p className="text-[11px] text-slate-500 font-mono break-all max-w-full" title={detail}>
          {detail}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onInstall}
        className={cn(
          "h-7 px-3 rounded border text-xs font-bold disabled:opacity-50 flex items-center gap-1.5",
          isGreen
            ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20"
            : "border-slate-600 text-slate-300 bg-slate-800/60 hover:bg-slate-800",
        )}
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
      {error ? <p className="text-xs text-rose-400 break-all">{error}</p> : null}
      {log.length > 0 ? (
        <pre className="text-[11px] text-slate-500 max-h-24 max-w-full overflow-auto font-mono whitespace-pre-wrap break-all">
          {log.slice(-12).join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * Renders provider-specific runtime installation controls, diagnostics, and hardware guidance.
 *
 * @param providerId - The execution provider associated with the card.
 * @param hardwareProbe - Current hardware and runtime detection results.
 * @param trtRtxNeedsInstall - Whether the TensorRT RTX runtime needs installation.
 * @param trtNeedsInstall - Whether the TensorRT runtime needs installation.
 * @param openvinoNeedsInstall - Whether the OpenVINO runtime needs installation.
 * @param hardwareInstallBusy - Whether any hardware runtime install is in flight.
 * @param installingTrtRtx - Whether the TensorRT RTX install is currently running.
 * @param installTrtRtxError - Last TensorRT RTX install error, if any.
 * @param installTrtRtxLog - TensorRT RTX install log lines.
 * @param onInstallTensorRtRtx - Starts the TensorRT RTX runtime install.
 * @param installingTrt - Whether the TensorRT install is currently running.
 * @param installTrtError - Last TensorRT install error, if any.
 * @param installTrtLog - TensorRT install log lines.
 * @param onInstallTensorRt - Starts the TensorRT runtime install.
 * @param openvinoInstall - OpenVINO installation state and action.
 * @param qnnInstall - QNN installation and NPU testing state and actions.
 * @param directMlInstall - DirectML installation state and action.
 * @param isPreMaxwellBox - Whether the NVIDIA GPU predates Maxwell (no TensorRT RTX support).
 * @param cudaNeedsOrtGpuInstall - Whether the ONNX Runtime GPU package needs installation for CUDA.
 * @param cudaToolkitMissingAndEpWorks - CUDA toolkit is missing but the CUDA EP still works.
 * @param cudaToolkitMissing - Whether the CUDA toolkit is missing entirely.
 * @param cudaEpInVenv - Whether the CUDA EP packages are available inside the venv.
 * @param nvidiaGpus - Detected NVIDIA GPUs, used for hardware guidance copy.
 * @param installingOrtGpu - Whether the ONNX Runtime GPU install is currently running.
 * @param installOrtGpuError - Last ONNX Runtime GPU install error, if any.
 * @param installOrtGpuLog - ONNX Runtime GPU install log lines.
 * @param onInstallOrtGpu - Starts the ONNX Runtime GPU package install.
 * @param isExpanded - Whether explanatory detail copy is expanded.
 */
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
  qnnInstall,
  directMlInstall,
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
  isExpanded,
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
  qnnInstall: HardwareProviderCardProps["qnnInstall"];
  directMlInstall: HardwareProviderCardProps["directMlInstall"];
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
  /** Explanatory copy stays collapsed by default; install actions themselves never do. */
  isExpanded: boolean;
}) {
  if (providerId === "NvTensorRTRTXExecutionProvider" && trtRtxNeedsInstall) {
    return (
      <PluginInstallBlock
        description={
          <>
            GPU is compatible. The TensorRT RTX runtime is a separate package (not the full TensorRT
            SDK). Pre-install into the project <code className="text-slate-400">.venv</code> to enable
            detection, or it will install automatically on first run.
          </>
        }
        detail={hardwareProbe?.tensorRtRtx?.detail}
        busy={hardwareInstallBusy}
        installing={installingTrtRtx}
        installLabel="Pre-install tensorrt-rtx"
        installingLabel="Installing tensorrt-rtx…"
        onInstall={onInstallTensorRtRtx}
        error={installTrtRtxError}
        log={installTrtRtxLog}
        variant="compatible"
        isExpanded={isExpanded}
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
        installLabel="Pre-install full TensorRT"
        installingLabel="Installing tensorrt…"
        onInstall={onInstallTensorRt}
        error={installTrtError}
        log={installTrtLog}
        variant="compatible"
        isExpanded={isExpanded}
      />
    );
  }
  if (providerId === "OpenVINOExecutionProvider" && openvinoNeedsInstall) {
    const hasIntelHardware = hardwareProbe ? computeOpenVinoCompatibleHardware({
      cpuModel: hardwareProbe.platform.cpuModel,
      openvinoDevices: hardwareProbe.openvino?.devices,
    }) : false;
    return (
      <PluginInstallBlock
        description={
          <>
            OpenVINOExecutionProvider is not ready. Pre-install prepares the isolated{" "}
            <code className="text-slate-400">.venvs/openvino</code> runtime with{" "}
            <code className="text-slate-400">onnxruntime-openvino</code>,{" "}
            <code className="text-slate-400">openvino</code>, and{" "}
            <code className="text-slate-400">optimum-intel[openvino]</code>. Will also install
            automatically on first run if needed.
          </>
        }
        detail={hardwareProbe?.openvino?.detail}
        busy={hardwareInstallBusy}
        installing={openvinoInstall.state.installing}
        installLabel="Pre-install OpenVINO runtime"
        installingLabel="Installing OpenVINO runtime…"
        onInstall={() => void openvinoInstall.install()}
        error={openvinoInstall.state.error}
        log={openvinoInstall.state.log}
        variant={hasIntelHardware ? "compatible" : "cross-compile"}
        isExpanded={isExpanded}
      />
    );
  }
  const qnnNeedsInstall =
    Boolean(hardwareProbe) &&
    isProviderDetectedLocally("QNNExecutionProvider", hardwareProbe) &&
    hardwareProbe?.qnn?.loadable !== true;
  const qnnShowTestNpu =
    providerId === "QNNExecutionProvider" &&
    hardwareProbe?.qnn?.hostMode === "local-inference" &&
    hardwareProbe?.qnn?.loadable === true;
  const directMlNeedsInstall =
    computeDirectMlHardwareReady({ os: hardwareProbe?.platform.os ?? "" }) &&
    Boolean(hardwareProbe) &&
    !isProviderDetectedLocally("DmlExecutionProvider", hardwareProbe);

  if (providerId === "QNNExecutionProvider" && (qnnNeedsInstall || qnnShowTestNpu)) {
    const mode = hardwareProbe?.qnn?.hostMode;
    const prepOnly = mode === "preparation";
    return (
      <div className="mt-2 space-y-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
        {qnnNeedsInstall ? (
          <PluginInstallBlock
            description={
              <>
                Install prepares isolated <code className="text-slate-400">.venvs/qnn</code> with{" "}
                <code className="text-slate-400">onnxruntime==1.26.0</code> +{" "}
                <code className="text-slate-400">onnxruntime-qnn==2.4.0</code>
                {prepOnly
                  ? ". Windows x64: preparation / plugin AOT only (not local HTP inference)."
                  : ". Windows ARM64: runtime install first; “QNN NPU ready” waits on the Snapdragon release gate."}
                {!isQnnSnapdragonReleaseGatePassed()
                  ? " UI will show “QNN runtime installed”, not “QNN NPU ready”, until that gate passes."
                  : ""}
              </>
            }
            detail={hardwareProbe?.qnn?.detail}
            busy={hardwareInstallBusy || qnnInstall.state.testing}
            installing={qnnInstall.state.installing}
            installLabel="Pre-install QNN runtime"
            installingLabel="Installing QNN runtime…"
            onInstall={() => void qnnInstall.install()}
            error={qnnInstall.state.error}
            log={qnnInstall.state.log}
            isExpanded={isExpanded}
          />
        ) : null}
        {qnnShowTestNpu ? (
          <button
            type="button"
            disabled={hardwareInstallBusy || qnnInstall.state.installing || qnnInstall.state.testing}
            onClick={() => void qnnInstall.testNpu()}
            className="h-7 px-3 rounded border border-slate-600 text-slate-300 bg-slate-800/60 hover:bg-slate-800 text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
          >
            {qnnInstall.state.testing ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" />
                Testing QNN NPU…
              </>
            ) : (
              "Test QNN NPU (cached HTP diagnostic)"
            )}
          </button>
        ) : null}
        <a
          href={QNN_ADVANCED_QAIRT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
          onClick={(e) => e.stopPropagation()}
        >
          Advanced QAIRT / SDK tooling <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }
  if (providerId === "DmlExecutionProvider" && directMlNeedsInstall) {
    return (
      <PluginInstallBlock
        description={
          <>
            DirectML EP not registered in the default Windows runtime. Pre-install{" "}
            <code className="text-slate-400">onnxruntime-directml</code> into{" "}
            <code className="text-slate-400">.venv</code> so{" "}
            <code className="text-slate-400">DmlExecutionProvider</code> loads for recipes and
            live runs, or it will install automatically on first run.
          </>
        }
        busy={hardwareInstallBusy}
        installing={directMlInstall.state.installing}
        installLabel="Pre-install onnxruntime-directml"
        installingLabel="Installing onnxruntime-directml…"
        onInstall={() => void directMlInstall.install()}
        error={directMlInstall.state.error}
        log={directMlInstall.state.log}
        variant="compatible"
        isExpanded={isExpanded}
      />
    );
  }
  if (providerId === "CUDAExecutionProvider" && isPreMaxwellBox) {
    return (
      <div className="mt-2 space-y-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-rose-400/90 leading-relaxed">
          {nvidiaGpus.map((g) => g.name).join(", ")} predates the CUDA 12 toolkit floor (compute
          capability ≥ {CUDA_SM_FLOOR}, Maxwell / RTX 20xx+). Installing the toolkit or the CUDA
          wheel cannot recover this. These cards cannot execute modern CUDA. Use the CPU provider,
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
                <code className="text-slate-400">.venv</code>. Pre-install the pinned
                wheel (
                <code className="text-slate-400 font-mono break-all">{pinnedOrtGpuInstallCommand()}</code>
                ) or it will install automatically on first run.
              </>
            }
            detail={hardwareProbe?.cuda?.detail}
            busy={hardwareInstallBusy}
            installing={installingOrtGpu}
            installLabel="Pre-install onnxruntime-gpu"
            installingLabel="Installing onnxruntime-gpu…"
            onInstall={onInstallOrtGpu}
            error={installOrtGpuError}
            log={installOrtGpuLog}
            variant="compatible"
            isExpanded={isExpanded}
          />
        ) : null}
        {isExpanded && cudaToolkitMissing && cudaEpInVenv ? (
          <p className="text-xs text-amber-500/80 leading-relaxed">
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
  if (
    providerId === "ROCMExecutionProvider" &&
    Boolean(hardwareProbe?.rocm?.gpus.length) &&
    !hardwareProbe?.onnxRuntimeProviders?.includes("ROCMExecutionProvider")
  ) {
    const rocmUrl = rocmDownloadUrlForOs(hardwareProbe?.platform.os);
    return (
      <div className="mt-2 space-y-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
        {isExpanded && (
          <p className="text-xs text-emerald-400/90 leading-relaxed">
            AMD GPU detected ({hardwareProbe?.rocm?.gpus.map((g) => g.name).join(", ")}). ROCm
            runtime is required for the ROCM execution provider. Install from AMD, then re-probe.
          </p>
        )}
        <a
          href={rocmUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded border border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-bold"
          onClick={(e) => e.stopPropagation()}
        >
          Get ROCm from AMD
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }
  return null;
}

function OpenVinoDeviceHint({ hardwareProbe }: { hardwareProbe: HardwareProbeResult | null }) {
  const devices = hardwareProbe?.openvino?.devices ?? [];
  if (devices.length === 0 || devices.some((d) => /GPU|NPU/i.test(d))) return null;
  return (
    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
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
      <p className="text-sm text-slate-500 flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
        {isSelected ? "Passes to fix on this target" : "Adjustments needed to use this target"}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pb-1">
        {pConflicts.map((c, idx) => (
          <div
            key={idx}
            className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-900 flex items-start gap-2 text-sm"
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${c.severity === "critical" ? "bg-rose-500" : "bg-amber-400"
                }`}
            />
            <div className="leading-tight">
              <span
                className={`font-bold block text-xs mb-0.5 ${c.severity === "critical" ? "text-rose-300" : "text-amber-400"
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
          className={`text-[9.5px] uppercase tracking-wider font-extrabold px-3 py-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 ${cardHasCritical
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

export const HardwareProviderCard = memo(function HardwareProviderCard({
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
  qnnInstall,
  directMlInstall,
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
  // Selected card starts open so the active target's details aren't hidden behind a click.
  // Snap expand/collapse when selection changes; user can still toggle while selected.
  const [isExpanded, setIsExpanded] = useState(isSelected);
  const [wasSelected, setWasSelected] = useState(isSelected);
  if (wasSelected !== isSelected) {
    setWasSelected(isSelected);
    setIsExpanded(isSelected);
  }
  const Icon = p.icon;
  const pConflicts = getProviderConflicts(p.id, state.passes);
  const cardHasCritical = pConflicts.some((c) => c.severity === "critical");
  const cardHardwareBlocked =
    !isExportTargetProvider(p.id) &&
    !isPlatformLocalProvider(p.id) &&
    Boolean(getProviderHardwareBlock(p.id, hardwareProbe));
  const cardBlocked = cardHasCritical || cardHardwareBlocked;
  const cardHasWarning = pConflicts.some((c) => c.severity === "warning");
  const showSwitchAssist = pConflicts.length > 0 && (isSelected || !cardBlocked);
  const detectedLocally = isProviderDetectedLocally(p.id, hardwareProbe);
  const isWebGpuTarget = p.id === "WebGpuExecutionProvider";
  const isExportTarget = isExportTargetProvider(p.id);
  const isLegacyTarget = isLegacyExportProvider(p.id);
  const isPlatformTarget = isPlatformLocalProvider(p.id);
  const qnnNeedsInstall =
    Boolean(hardwareProbe) &&
    isProviderDetectedLocally("QNNExecutionProvider", hardwareProbe) &&
    hardwareProbe?.qnn?.loadable !== true;
  const directMlNeedsInstall =
    computeDirectMlHardwareReady({ os: hardwareProbe?.platform.os ?? "" }) &&
    Boolean(hardwareProbe) &&
    !isProviderDetectedLocally("DmlExecutionProvider", hardwareProbe);
  const needsPluginInstall =
    (p.id === "NvTensorRTRTXExecutionProvider" && trtRtxNeedsInstall) ||
    (p.id === "TensorrtExecutionProvider" && trtNeedsInstall) ||
    (p.id === "OpenVINOExecutionProvider" && openvinoNeedsInstall) ||
    (p.id === "QNNExecutionProvider" && qnnNeedsInstall) ||
    (p.id === "DmlExecutionProvider" && directMlNeedsInstall) ||
    (p.id === "CUDAExecutionProvider" && cudaNeedsOrtGpuInstall);

  // DML on Windows: hardware is compatible (DX12 guaranteed) even though runtime isn't detected yet.
  // This lets the badge show green "Compatible, runtime available" instead of gray "Not on this system".
  const hardwareCompatibleNotDetected =
    p.id === "DmlExecutionProvider" && directMlNeedsInstall && !detectedLocally;

  const { cardClasses, badgeText, BadgeIcon, badgeColor, badgeIconColor } = resolveCardChrome({
    isSelected,
    cardBlocked,
    cardHardwareBlocked,
    cardHasCritical,
    cardHasWarning,
    isWebGpuTarget,
    isExportTarget,
    isLegacyTarget,
    isPlatformTarget,
    detectedLocally: detectedLocally || hardwareCompatibleNotDetected,
    probeLoading,
    needsPluginInstall,
  });
  const hardwareDetail = hardwareDetailFor(p.id, hardwareProbe);

  const detailsId = `hardware-provider-details-${p.id}`;
  const onSelect = () =>
    selectProvider(p.id, state, setState, hardwareProbe, detectedProviders, pConflicts, isSelected);

  return (
    <div onClick={onSelect} className={cardClasses}>
      <div className="flex items-start gap-4 min-w-0">
        <div
          className={`mt-0.5 shrink-0 rounded-xl p-2.5 transition-all ${isSelected
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
              {BadgeIcon ? (
                <BadgeIcon className={cn("h-3 w-3", badgeIconColor)} aria-hidden />
              ) : null}
              {badgeText}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-sm text-slate-400 leading-relaxed pr-6 cursor-help border-b border-dashed border-slate-700 hover:border-slate-500 transition-colors">
                {p.desc}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[360px] bg-slate-950 border border-slate-800 text-slate-300 p-4 shadow-2xl leading-relaxed z-50"
            >
              <div className="space-y-3">
                <div className="border-b border-slate-900 pb-2">
                  <p className="text-sm font-bold text-electric-blue uppercase tracking-wide">{p.name}</p>
                </div>
                <div>
                  <p className="text-[11px] font-mono uppercase text-slate-500 mb-1">Requirements</p>
                  <p className="text-xs text-slate-300 leading-relaxed">{p.tooltip.requirements}</p>
                </div>
                <div>
                  <p className="text-[11px] font-mono uppercase text-slate-500 mb-1">Quantization Methods</p>
                  <p className="text-xs text-slate-300 leading-relaxed">{p.tooltip.quantMethods}</p>
                </div>
                <div>
                  <p className="text-[11px] font-mono uppercase text-slate-500 mb-1">Recommendation</p>
                  <p className="text-xs text-emerald-400/90 leading-relaxed">{p.tooltip.recommendation}</p>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((v) => !v);
            }}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-400 transition-colors cursor-pointer"
            aria-expanded={isExpanded}
            aria-controls={detailsId}
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-180")}
            />
            {isExpanded ? "Hide details" : "Show details"}
          </button>
          {/* Always surfaced, independent of the details toggle — a user should never have to
              expand a card to find the action that fixes "not ready" / "needs install". */}
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
            qnnInstall={qnnInstall}
            directMlInstall={directMlInstall}
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
            isExpanded={isExpanded}
          />
          {isExpanded && (
            <div id={detailsId}>
              {detectedLocally && hardwareDetail ? (
                <p className="text-xs text-emerald-400/90 font-mono break-words">{hardwareDetail}</p>
              ) : null}
              {p.id === "OpenVINOExecutionProvider" ? (
                <OpenVinoDeviceHint hardwareProbe={hardwareProbe} />
              ) : null}
              {isWebGpuTarget ? (
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Not a local Python EP. Select to build web-oriented recipes, then use{" "}
                  <span className="text-slate-400">Recipe &amp; run → Browser Test</span> / WebGPU benchmark in
                  Chrome or Edge 113+.
                </p>
              ) : null}
              {isExportTarget && !isWebGpuTarget ? (
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  {isLegacyTarget
                    ? "Legacy export path (prefer QNN for Snapdragon). Not available for Studio Execute Live."
                    : "Export / deploy target only. Not a local Python EP, so Execute Live stays blocked."}
                </p>
              ) : null}
              {isPlatformTarget && !detectedLocally && !probeLoading ? (
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Platform EP: selectable for recipes; Execute Live requires a matching ORT probe hit on this host.
                </p>
              ) : null}
              {!detectedLocally &&
                !probeLoading &&
                !isExportTarget &&
                !isPlatformTarget &&
                !needsPluginInstall ? (
                <p className="text-xs text-slate-600">
                  {p.id === "CPUExecutionProvider"
                    ? "Hardware detection unavailable. CPU status is unknown."
                    : "No matching hardware found locally. You can still select for remote/cross-compile targets."}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center shrink-0">
          <div
            className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected
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
                className={`h-2.5 w-2.5 rounded-full ${cardHasCritical ? "bg-rose-500" : cardHasWarning ? "bg-amber-500" : "bg-electric-blue"
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
        <p className="mt-3 pt-3 border-t border-slate-800/60 text-xs text-slate-500 leading-relaxed">
          Incompatible with your current passes. Change passes in Optimization or select a compatible target
          above.
        </p>
      ) : null}
    </div>
  );
});
