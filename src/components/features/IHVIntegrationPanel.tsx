import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  Select,
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { IHVProvider, UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import {
  applyProviderConflictAutofixes,
  getProviderConflicts,
  getProviderHardwareBlock,
  getQuantMethodActivationBlock,
  isConversionFormatAllowed,
  isPeftAllowed,
  isPeftMethodAllowed,
  isQuantMethodAllowed,
  isStructuredPruningAllowed,
  prepareProviderChange,
} from "@/lib/pipelineValidation";
import { isMemoryOffloadAvailable, hasHuggingFaceModel } from "@/lib/memoryOffload";
import { isGpuProvider, formatMemoryGb } from "@/lib/vramEstimate";
import {
  fetchHardwareProbe,
  getSelectableProviders,
  isProviderDetectedLocally,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import {
  Settings2,
  AlertTriangle,
  ShieldAlert,
  Check,
  Wand2,
  Activity,
  Lock,
  CheckCircle,
  AlertCircle,
  Search,
  Table,
  List,
  RefreshCw,
  HardDrive,
} from "lucide-react";

export { getProviderConflicts };

const providers = PROVIDER_CATALOG;

interface OptimizationPassValidation {
  id: string;
  name: string;
  category: "Conversion" | "Quantization" | "Compression" | "PEFT";
  description: string;
  isUnsupported: (provider: IHVProvider) => boolean;
  getIncompatibilityReason: (provider: IHVProvider) => string;
  isActive: (passes: UIState["passes"]) => boolean;
  toggle: (passes: UIState["passes"], currentActive: boolean) => Partial<UIState["passes"]>;
  requiresExplanation: string;
}

const validations: OptimizationPassValidation[] = [
  {
    id: "openvino-format",
    name: "OpenVINO IR Conversion Stage",
    category: "Conversion",
    description:
      "Compiles standard execution graphs into the highly optimized Intel OpenVINO XML/BIN Intermediate Representation.",
    isUnsupported: (provider) => !isConversionFormatAllowed("openvino", provider),
    getIncompatibilityReason: () => "Requires Intel OpenVINO hardware target.",
    isActive: (passes) => passes.conversion && passes.conversionFormat === "openvino",
    toggle: (passes, active) =>
      active
        ? { ...passes, conversionFormat: "onnx" }
        : { ...passes, conversion: true, conversionFormat: "openvino" },
    requiresExplanation:
      "Standard CPU, NVIDIA Titan/GeForce/RTX, Qualcomm Snapdragon, and AMD hosts expect standard ONNX models instead of proprietary Intel IR files.",
  },
  {
    id: "awq-quantization",
    name: "AWQ Activation-Aware Quantization",
    category: "Quantization",
    description:
      "Protects high-salient channel weights dynamically from rounding errors, protecting baseline math precision.",
    isUnsupported: (provider) => !isQuantMethodAllowed("awq", provider),
    getIncompatibilityReason: () => "Requires NVIDIA/AMD high-performance compute host.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "awq",
    toggle: (passes, active) =>
      active
        ? { ...passes, quantMethod: "ptq" }
        : { ...passes, quantization: true, quantMethod: "awq", pruning: false },
    requiresExplanation:
      "AWQ is fine-tuned for heavy linear layers utilizing specialized CUDA or ROCm GPU acceleration matrices.",
  },
  {
    id: "qat-quantization",
    name: "Quantization-Aware Training (QAT)",
    category: "Quantization",
    description:
      "Instruments training backpropagation to emulate integer quantization noise, producing highly robust integer models.",
    isUnsupported: (provider) => !isQuantMethodAllowed("qat", provider),
    getIncompatibilityReason: () => "Snapdragon NPU does not support active QAT pipelines.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "qat",
    toggle: (passes, active) =>
      active ? { ...passes, quantMethod: "ptq" } : { ...passes, quantization: true, quantMethod: "qat" },
    requiresExplanation:
      "Qualcomm Snapdragon Hexagon NPUs require standard offline Post-Training Quantization (PTQ) formats to run properly.",
  },
  {
    id: "structured-sparsity",
    name: "Structured 2:4 Sparsity Pruning",
    category: "Compression",
    description:
      "Systematically zeros out 2 out of every 4 block elements to maximize memory access efficiency.",
    isUnsupported: (provider) => !isStructuredPruningAllowed(provider),
    getIncompatibilityReason: () => "Requires built-in NVIDIA Ampere+ Tensor Cores.",
    isActive: (passes) => passes.pruning && passes.pruningType === "structured",
    toggle: (passes, active) =>
      active
        ? { ...passes, pruningType: "unstructured" }
        : { ...passes, pruning: true, pruningType: "structured" },
    requiresExplanation:
      "2:4 block sparsity requires built-in hardware decoding logic integrated exclusively into modern NVIDIA RTX or enterprise datacenter GPUs.",
  },
  {
    id: "peft-adapters",
    name: "PEFT LoRA Training Stage",
    category: "PEFT",
    description:
      "Locks core parameters to fine-tune compact rank-adapters, drastically boosting training speed and reducing VRAM footprint.",
    isUnsupported: (provider) => !isPeftAllowed(provider),
    getIncompatibilityReason: () => "NPUs are strictly optimized for static low-power inference.",
    isActive: (passes) => passes.peft,
    toggle: (passes, active) => (active ? { ...passes, peft: false } : { ...passes, peft: true }),
    requiresExplanation:
      "Edge-facing Snapdragon or Intel NPU architectures cannot execute full training loops. Adapter configurations must be compiled on CPU/GPU.",
  },
  {
    id: "qlora-adapters",
    name: "Double-Quantized QLoRA Adapter Tuning",
    category: "PEFT",
    description:
      "Pairs LoRA rank updates with highly compressed 4-bit NormalFloat parameters to allow massive model adjustments.",
    isUnsupported: (provider) => !isPeftMethodAllowed("qlora", provider),
    getIncompatibilityReason: () => "Requires GPU CUDA/ROCm acceleration.",
    isActive: (passes) => passes.peft && passes.peftMethod === "qlora",
    toggle: (passes, active) =>
      active ? { ...passes, peftMethod: "lora" } : { ...passes, peft: true, peftMethod: "qlora" },
    requiresExplanation:
      "QLoRA requires active, high-fidelity dynamic double-quantization backpropagation kernels which are completely unsupported on standard CPU hosts.",
  },
];

/**
 * Determines the compatibility and estimated optimization characteristics of a pass for a provider.
 *
 * @param pass - The optimization pass to evaluate
 * @param provider - The execution provider to evaluate
 * @param passes - The configured optimization passes used to identify configuration conflicts
 * @returns Compatibility status, explanation, and estimated performance characteristics
 */
export function getCellCompatibility(
  pass: OptimizationPassValidation,
  provider: IHVProvider,
  passes?: UIState["passes"],
) {
  const isUnsupported = pass.isUnsupported(provider);

  if (passes && pass.id === "awq-quantization" && !isUnsupported) {
    const block = getQuantMethodActivationBlock("awq", passes, provider);
    if (block) {
      return {
        status: "blocked" as const,
        label: "Config blocked",
        color: "bg-amber-500/15 border-amber-500/30 text-amber-400",
        reason: block.reason,
        speedup: "N/A",
        vram: "N/A",
        efficiency: "0%",
      };
    }
  }

  if (passes && pass.id === "qat-quantization" && !isUnsupported) {
    const block = getQuantMethodActivationBlock("qat", passes, provider);
    if (block) {
      return {
        status: "blocked" as const,
        label: "Config blocked",
        color: "bg-amber-500/15 border-amber-500/30 text-amber-400",
        reason: block.reason,
        speedup: "N/A",
        vram: "N/A",
        efficiency: "0%",
      };
    }
  }

  if (isUnsupported) {
    return {
      status: "unsupported" as const,
      label: "Incompatible",
      color: "bg-rose-500/15 border-rose-500/30 text-rose-400",
      reason: pass.getIncompatibilityReason(provider),
      speedup: "N/A",
      vram: "N/A",
      efficiency: "0%",
    };
  }

  if (provider === "CPUExecutionProvider") {
    if (pass.id === "peft-adapters" || pass.id === "qlora-adapters") {
      return {
        status: "partial" as const,
        label: "CPU Fallback",
        color: "bg-amber-500/15 border-amber-500/30 text-amber-400",
        reason:
          "Executes correctly but lacks hardware tensor cores. Active tuning is extremely slow on CPUs.",
        speedup: "1.0x (Baseline)",
        vram: "System RAM (-20%)",
        efficiency: "15% (Fallback)",
      };
    }
  }

  // Supported and optimized!
  let speedup = "2.2x";
  let vram = "-50%";
  let efficiency = "95%";

  if (pass.id === "openvino-format") {
    speedup = "3.1x";
    vram = "Host Shared";
    efficiency = "98%";
  } else if (pass.id === "awq-quantization") {
    speedup = "2.5x";
    vram = "-72% VRAM";
    efficiency = "92%";
  } else if (pass.id === "qat-quantization") {
    speedup = "1.8x";
    vram = "-50% VRAM";
    efficiency = "88%";
  } else if (pass.id === "structured-sparsity") {
    speedup = "2.0x";
    vram = "No Change";
    efficiency = "99%";
  } else if (pass.id === "peft-adapters") {
    speedup = "1.6x (Tuned)";
    vram = "-60% VRAM";
    efficiency = "94%";
  } else if (pass.id === "qlora-adapters") {
    speedup = "1.5x (Tuned)";
    vram = "-82% VRAM";
    efficiency = "90%";
  }

  return {
    status: "supported" as const,
    label: "Optimized",
    color: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
    reason: "Fully supported. Direct edge hardware instruction sets mapped successfully.",
    speedup,
    vram,
    efficiency,
  };
}

/**
 * Configures hardware acceleration providers and optimization passes for the pipeline.
 *
 * Uses the provided pipeline state and updater when available, or the pipeline store otherwise.
 *
 * @param state - Optional pipeline state to display and modify.
 * @param setState - Optional updater for applying pipeline state changes.
 */
export function IHVIntegrationPanel({
  state: propState,
  setState: propSetState,
}: {
  state?: UIState;
  setState?: (s: Partial<UIState>) => void;
} = {}) {
  const storeState = usePipelineState();
  const state = propState ?? storeState.state;
  const setState = propSetState ?? storeState.setState;
  const [passSearch, setPassSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"matrix" | "cards">("matrix");
  const [selectedCategory, setSelectedCategory] = useState<
    "All" | "Conversion" | "Quantization" | "Compression" | "PEFT"
  >("All");
  const [hardwareProbe, setHardwareProbe] = useState<HardwareProbeResult | null>(null);
  const [probeLoading, setProbeLoading] = useState(true);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [installingTrtRtx, setInstallingTrtRtx] = useState(false);
  const [installTrtRtxError, setInstallTrtRtxError] = useState<string | null>(null);
  const [installTrtRtxLog, setInstallTrtRtxLog] = useState<string[]>([]);

  const hasAutoAppliedRef = useRef(false);

  const trtRtxNeedsInstall =
    Boolean(hardwareProbe?.nvidia?.gpus.length) && hardwareProbe?.tensorRtRtx?.loadable !== true;

  const handleInstallTensorRtRtx = async () => {
    setInstallingTrtRtx(true);
    setInstallTrtRtxError(null);
    setInstallTrtRtxLog([]);
    try {
      const res = await fetch("/api/env/install-tensorrt-rtx", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        log?: string[];
        probe?: HardwareProbeResult;
      };
      if (Array.isArray(data.log)) setInstallTrtRtxLog(data.log);
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Install failed (HTTP ${res.status})`);
      }
      if (data.probe) {
        setHardwareProbe(data.probe);
      } else {
        await runHardwareProbe(true);
      }
    } catch (err) {
      setInstallTrtRtxError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingTrtRtx(false);
    }
  };

  const runHardwareProbe = useCallback(
    async (refresh = false) => {
      setProbeLoading(true);
      setProbeError(null);
      try {
        const result = await fetchHardwareProbe(refresh);
        setHardwareProbe(result);

        // Auto-apply recommended provider on first probe completion
        if (!hasAutoAppliedRef.current && result.recommendedProvider) {
          hasAutoAppliedRef.current = true;
          setState({ ihvProvider: result.recommendedProvider });
        }
      } catch (err) {
        setProbeError(err instanceof Error ? err.message : "Hardware probe failed.");
        setHardwareProbe(null);
      } finally {
        setProbeLoading(false);
      }
    },
    [setState],
  );

  useEffect(() => {
    void runHardwareProbe(false);
  }, [runHardwareProbe]);

  const filteredValidations = validations.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(passSearch.toLowerCase()) ||
      v.description.toLowerCase().includes(passSearch.toLowerCase()) ||
      v.category.toLowerCase().includes(passSearch.toLowerCase());
    const matchesCategory = selectedCategory === "All" || v.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Real-time conflicts of the selected hardware provider
  const selectedConflicts = getProviderConflicts(state.ihvProvider, state.passes);
  const selectableProviders = useMemo(() => providers, []);
  const detectedProviders = useMemo(() => getSelectableProviders(hardwareProbe), [hardwareProbe]);
  const locallyDetectedCount = useMemo(
    () => selectableProviders.filter((p) => isProviderDetectedLocally(p.id, hardwareProbe)).length,
    [selectableProviders, hardwareProbe],
  );
  const hasSelectedCritical = selectedConflicts.some((c) => c.severity === "critical");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Card>
        <CardHeader
          title="Hardware acceleration"
          description="Select execution provider and accelerator target. Olive optimizes graphs for the chosen backend."
        />
        <CardContent>
          {/* Live hardware probe from this machine */}
          <div className="mb-6 rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-electric-blue shrink-0" />
                  <h4 className="text-sm font-medium text-slate-200">Detected on this machine</h4>
                  {probeLoading && <span className="text-[10px] font-mono text-slate-500">Scanning…</span>}
                </div>
                {probeError ? (
                  <p className="text-xs text-rose-400">{probeError}</p>
                ) : hardwareProbe ? (
                  <div className="space-y-1.5 text-xs text-slate-400">
                    <p>
                      <span className="text-slate-500">CPU:</span>{" "}
                      <span className="text-slate-200">{hardwareProbe.platform.cpuModel}</span>
                      <span className="text-slate-600">
                        {" "}
                        · {hardwareProbe.platform.cpuCores} cores · {hardwareProbe.platform.os} (
                        {hardwareProbe.platform.arch})
                      </span>
                    </p>
                    <p>
                      <span className="text-slate-500">System RAM:</span>{" "}
                      <span className="text-slate-200 font-mono">
                        {hardwareProbe.platform.systemRamGb != null
                          ? formatMemoryGb(hardwareProbe.platform.systemRamGb)
                          : "Unknown"}
                      </span>
                    </p>
                    {hardwareProbe.nvidia?.gpus.length ? (
                      <p>
                        <span className="text-slate-500">NVIDIA:</span>{" "}
                        <span className="text-slate-200">
                          {hardwareProbe.nvidia.gpus
                            .map((g) =>
                              g.vramMb ? `${g.name} (${formatMemoryGb(g.vramMb / 1024)})` : g.name,
                            )
                            .join(", ")}
                        </span>
                        {hardwareProbe.nvidia.cudaVersion && (
                          <span className="text-slate-600">
                            {" "}
                            · driver CUDA {hardwareProbe.nvidia.cudaVersion}
                            {hardwareProbe.nvidia.cudaTag ? ` → ${hardwareProbe.nvidia.cudaTag}` : ""}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p>
                        <span className="text-slate-500">NVIDIA:</span>{" "}
                        <span className="text-slate-600">not detected</span>
                      </p>
                    )}
                    {hardwareProbe.rocm?.gpus.length ? (
                      <p>
                        <span className="text-slate-500">AMD ROCm:</span>{" "}
                        <span className="text-slate-200">
                          {hardwareProbe.rocm.gpus
                            .map((g) =>
                              g.vramMb ? `${g.name} (${formatMemoryGb(g.vramMb / 1024)})` : g.name,
                            )
                            .join(", ")}
                        </span>
                      </p>
                    ) : null}
                    {hardwareProbe.openvino?.available ? (
                      <p>
                        <span className="text-slate-500">OpenVINO:</span>{" "}
                        <span className="text-slate-200">
                          Python package v{hardwareProbe.openvino.version ?? "unknown"}
                        </span>
                      </p>
                    ) : null}
                    {hardwareProbe.onnxRuntimeProviders?.length ? (
                      <p>
                        <span className="text-slate-500">ONNX Runtime EPs:</span>{" "}
                        <span className="font-mono text-[11px] text-emerald-400">
                          {hardwareProbe.onnxRuntimeProviders.join(", ")}
                        </span>
                      </p>
                    ) : null}
                    <p className="text-[11px] text-slate-500 pt-1">
                      Recommended target:{" "}
                      <span className="text-electric-blue font-semibold">
                        {providers.find((p) => p.id === hardwareProbe.recommendedProvider)?.name ??
                          hardwareProbe.recommendedProvider}
                      </span>
                      {state.ihvProvider !== hardwareProbe.recommendedProvider && (
                        <button
                          type="button"
                          onClick={() => setState({ ihvProvider: hardwareProbe.recommendedProvider })}
                          className="ml-2 text-xs text-electric-blue hover:text-white cursor-pointer"
                        >
                          Apply
                        </button>
                      )}
                    </p>
                  </div>
                ) : !probeLoading ? (
                  <p className="text-xs text-slate-500">No hardware data yet.</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void runHardwareProbe(true)}
                disabled={probeLoading}
                className="flex items-center gap-1.5 self-start rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600 hover:text-white disabled:opacity-50 cursor-pointer shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${probeLoading ? "animate-spin" : ""}`} />
                Re-scan hardware
              </button>
            </div>
          </div>

          <VramEstimateBanner state={state} hardwareProbe={hardwareProbe} className="mb-6" />

          {/* Hardware Validation Guard Alert Summary Banner */}
          {selectedConflicts.length > 0 && (
            <div
              className={`mb-6 rounded-xl border p-4.5 animate-in slide-in-from-top-2 duration-300 flex flex-col gap-3.5 ${
                hasSelectedCritical
                  ? "bg-rose-950/15 border-rose-500/30 shadow-[0_2px_12px_rgba(244,63,94,0.03)]"
                  : "bg-amber-955/15 border-amber-500/30 shadow-[0_2px_12px_rgba(245,158,11,0.03)]"
              }`}
            >
              <div className="flex items-start md:items-center justify-between border-b border-slate-800/80 pb-3 flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded shrink-0 ${
                      hasSelectedCritical ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-500"
                    }`}
                  >
                    {hasSelectedCritical ? (
                      <ShieldAlert className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <h4
                      className={`text-sm font-medium ${hasSelectedCritical ? "text-rose-300" : "text-amber-400"}`}
                    >
                      Pipeline conflict ({selectedConflicts.length})
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      The execution passes currently configured in your recipe are incompatible with the
                      selected
                      <span className="text-white font-semibold">
                        {" "}
                        {providers.find((p) => p.id === state.ihvProvider)?.name}
                      </span>
                      .
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setState({
                      passes: applyProviderConflictAutofixes(state.ihvProvider, state.passes),
                    });
                  }}
                  className={`text-xs px-3 py-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 hover:text-white ${
                    hasSelectedCritical
                      ? "border-rose-500/30 bg-rose-950/20 text-rose-400 hover:bg-rose-500/20"
                      : "border-amber-500/30 bg-amber-950/20 text-amber-400 hover:bg-amber-500/20"
                  }`}
                >
                  <Wand2 className="h-3 w-3" /> Auto-Fix Active Config Conflicts
                </button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500 mb-3">
            {probeLoading
              ? "Detecting local execution providers…"
              : `Showing all ${selectableProviders.length} providers. ${locallyDetectedCount} detected locally — undetected targets are still selectable for cross-compile / remote builds.`}
          </p>

          <div className="grid gap-4 mt-2">
            {probeLoading ? (
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-600" />
                Probing NVIDIA, AMD, Intel, and CPU runtimes…
              </div>
            ) : (
              <TooltipProvider delayDuration={200}>
                {selectableProviders.map((p) => {
                  const isSelected = state.ihvProvider === p.id;
                  const Icon = p.icon;

                  // Compute conflicts for this particular card to implement visual disabled indicators & warnings
                  const pConflicts = getProviderConflicts(p.id, state.passes);
                  const cardHasCritical = pConflicts.some((c) => c.severity === "critical");
                  const cardHardwareBlocked =
                    Boolean(getProviderHardwareBlock(p.id, hardwareProbe)) ||
                    (p.id === "CPUExecutionProvider" && !hardwareProbe);
                  const cardBlocked = cardHasCritical || cardHardwareBlocked;
                  const cardHasWarning = pConflicts.some((c) => c.severity === "warning");
                  const showSwitchAssist = pConflicts.length > 0 && (isSelected || !cardBlocked);
                  const detectedLocally = isProviderDetectedLocally(p.id, hardwareProbe);

                  let cardClasses =
                    "relative flex flex-col rounded-xl border p-4.5 transition-all duration-200 cursor-pointer ";
                  let badgeText = "";
                  let badgeColor = "";

                  if (isSelected) {
                    if (cardBlocked) {
                      cardClasses += "border-rose-500 bg-rose-500/5";
                      badgeText = cardHardwareBlocked ? "Unavailable hardware" : "Critical Conflict";
                      badgeColor = "bg-rose-500/10 text-rose-400 border-rose-550/25";
                    } else if (cardHasWarning) {
                      cardClasses += "border-amber-500 bg-amber-500/5";
                      badgeText = "Warning Conflict";
                      badgeColor = "bg-amber-500/10 text-amber-400 border-amber-550/25";
                    } else {
                      cardClasses += "border-electric-blue bg-electric-blue/5";
                      badgeText = !detectedLocally && !probeLoading ? "Active (not local)" : "Active Target";
                      badgeColor = "bg-electric-blue/10 text-electric-blue border-electric-blue/20";
                    }
                  } else if (cardHardwareBlocked) {
                    cardClasses +=
                      "border-rose-950/35 bg-zinc-950/40 opacity-55 hover:opacity-75 hover:border-slate-700";
                    badgeText = "Not on this system";
                    badgeColor = "bg-rose-500/5 text-rose-400/80 border-rose-550/15";
                  } else if (
                    p.id === "NvTensorRTRTXExecutionProvider" &&
                    trtRtxNeedsInstall &&
                    detectedLocally
                  ) {
                    cardClasses += "border-amber-900/40 bg-amber-950/10 opacity-95 hover:border-amber-500/40";
                    badgeText = "Plugin install needed";
                    badgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                  } else if (!detectedLocally && !probeLoading) {
                    cardClasses +=
                      "border-slate-850/60 bg-zinc-950/30 opacity-80 hover:opacity-100 hover:border-slate-700";
                    badgeText = "Not on this system";
                    badgeColor = "bg-slate-800/80 text-slate-500 border-slate-700/60";
                  } else if (cardHasCritical) {
                    cardClasses +=
                      "border-rose-950/35 bg-zinc-950/40 opacity-55 hover:opacity-100 hover:border-rose-500/40";
                    badgeText = "Incompatible";
                    badgeColor = "bg-rose-500/5 text-rose-400/80 border-rose-550/15";
                  } else if (cardHasWarning) {
                    cardClasses +=
                      "border-amber-950/35 bg-zinc-950/40 opacity-75 hover:opacity-100 hover:border-amber-500/40";
                    badgeText = "Needs Adjust";
                    badgeColor = "bg-amber-500/5 text-amber-400/80 border-amber-550/15";
                  } else {
                    cardClasses +=
                      "border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700";
                    badgeText = "Compatible with active passes";
                    badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/15";
                  }

                  const hardwareDetail =
                    p.id === "CUDAExecutionProvider" ||
                    p.id === "NvTensorRTRTXExecutionProvider" ||
                    p.id === "TensorrtExecutionProvider"
                      ? hardwareProbe?.nvidia?.gpus.map((g) => g.name).join(", ")
                      : p.id === "ROCMExecutionProvider"
                        ? hardwareProbe?.rocm?.gpus.map((g) => g.name).join(", ")
                        : p.id === "OpenVINOExecutionProvider" && hardwareProbe?.openvino?.available
                          ? `OpenVINO ${hardwareProbe.openvino.version ?? ""}`.trim()
                          : p.id === "CPUExecutionProvider" && hardwareProbe
                            ? hardwareProbe.platform.cpuModel
                            : null;

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        if (isSelected && pConflicts.length > 0) {
                          setState({ passes: applyProviderConflictAutofixes(p.id, state.passes) });
                          return;
                        }
                        // Allow selecting undetected providers for cross-compile / remote targets
                        const detected = detectedProviders.includes(p.id);
                        if (!detected) {
                          setState({ ihvProvider: p.id });
                          return;
                        }
                        const patch = prepareProviderChange(state, p.id, hardwareProbe);
                        if (patch) {
                          setState(patch);
                        }
                      }}
                      className={cardClasses}
                    >
                      <div className="flex items-start gap-4">
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

                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-slate-200 text-sm md:text-base leading-none">
                              {p.name}
                            </p>
                            <span
                              className={`text-[9px] font-mono uppercase tracking-wider font-extrabold px-2 py-0.5 rounded border ${badgeColor}`}
                            >
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
                                  <p className="text-xs font-bold text-electric-blue uppercase tracking-wide">
                                    {p.name}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-mono uppercase text-slate-500 mb-1">
                                    Requirements
                                  </p>
                                  <p className="text-[11px] text-slate-300 leading-relaxed">
                                    {p.tooltip.requirements}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-mono uppercase text-slate-500 mb-1">
                                    Quantization Methods
                                  </p>
                                  <p className="text-[11px] text-slate-300 leading-relaxed">
                                    {p.tooltip.quantMethods}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-mono uppercase text-slate-500 mb-1">
                                    Recommendation
                                  </p>
                                  <p className="text-[11px] text-emerald-400/90 leading-relaxed">
                                    {p.tooltip.recommendation}
                                  </p>
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                          {detectedLocally && hardwareDetail && (
                            <p className="text-[11px] text-emerald-400/90 font-mono">{hardwareDetail}</p>
                          )}
                          {p.id === "NvTensorRTRTXExecutionProvider" && trtRtxNeedsInstall && (
                            <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                              <p className="text-[11px] text-amber-400/90 leading-relaxed">
                                GPU is compatible. The TensorRT RTX runtime is a separate package (not the
                                full TensorRT SDK). Install into the project{" "}
                                <code className="text-slate-400">.venv</code> to enable detection and runs.
                              </p>
                              {hardwareProbe?.tensorRtRtx?.detail && (
                                <p
                                  className="text-[10px] text-slate-500 font-mono truncate"
                                  title={hardwareProbe.tensorRtRtx.detail}
                                >
                                  {hardwareProbe.tensorRtRtx.detail}
                                </p>
                              )}
                              <button
                                type="button"
                                disabled={installingTrtRtx}
                                onClick={() => void handleInstallTensorRtRtx()}
                                className="h-7 px-3 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 text-[11px] font-bold disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {installingTrtRtx ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    Installing tensorrt-rtx…
                                  </>
                                ) : (
                                  "Install tensorrt-rtx into .venv"
                                )}
                              </button>
                              {installTrtRtxError && (
                                <p className="text-[11px] text-rose-400">{installTrtRtxError}</p>
                              )}
                              {installTrtRtxLog.length > 0 && (
                                <pre className="text-[10px] text-slate-500 max-h-24 overflow-auto font-mono whitespace-pre-wrap">
                                  {installTrtRtxLog.slice(-12).join("\n")}
                                </pre>
                              )}
                            </div>
                          )}
                          {!detectedLocally && !probeLoading && (
                            <p className="text-[11px] text-slate-600">
                              {p.id === "CPUExecutionProvider"
                                ? "Hardware detection unavailable — CPU status is unknown."
                                : "No matching hardware found locally — you can still select for remote/cross-compile targets."}
                            </p>
                          )}
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
                            {isSelected && (
                              <div
                                className={`h-2.5 w-2.5 rounded-full ${
                                  cardHasCritical
                                    ? "bg-rose-500"
                                    : cardHasWarning
                                      ? "bg-amber-500"
                                      : "bg-electric-blue"
                                }`}
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Conflicts on the active target, or adjustable warnings on other targets */}
                      {showSwitchAssist && (
                        <div className="mt-3.5 pt-3.5 border-t border-slate-800/60 flex flex-col gap-2.5 animate-in fade-in duration-200">
                          <p className="text-xs text-slate-500 flex items-center gap-1.5">
                            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                            {isSelected
                              ? "Passes to fix on this target"
                              : "Adjustments needed to use this target"}
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
                                  <span className="text-slate-450 text-[10.5px] font-medium leading-relaxed">
                                    {c.reason}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isSelected) {
                                  setState({ passes: applyProviderConflictAutofixes(p.id, state.passes) });
                                  return;
                                }
                                // Allow switching to undetected providers for cross-compile / remote targets
                                const detected = detectedProviders.includes(p.id);
                                if (!detected) {
                                  setState({ ihvProvider: p.id });
                                  return;
                                }
                                const patch = prepareProviderChange(state, p.id, hardwareProbe);
                                if (patch) {
                                  setState(patch);
                                }
                              }}
                              className={`text-[9.5px] uppercase tracking-wider font-extrabold px-3 py-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 ${
                                cardHasCritical
                                  ? "border-rose-550/30 text-rose-400 bg-rose-950/20 hover:text-white hover:bg-rose-500/20"
                                  : "border-amber-500/30 text-amber-400 bg-amber-950/20 hover:text-white hover:bg-amber-550/20"
                              }`}
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              {isSelected
                                ? "Fix passes for this target"
                                : `Switch to ${p.shortName} (adjusts passes)`}
                            </button>
                          </div>
                        </div>
                      )}

                      {!isSelected && cardHasCritical && pConflicts.length > 0 && (
                        <p className="mt-3 pt-3 border-t border-slate-800/60 text-[11px] text-slate-500 leading-relaxed">
                          Incompatible with your current passes. Change passes in Optimization or select a
                          compatible target above.
                        </p>
                      )}
                    </div>
                  );
                })}
              </TooltipProvider>
            )}
          </div>

          {/* Hybrid offload — visible for Hugging Face models; toggle when GPU target selected */}
          {hasHuggingFaceModel(state) && (
            <div className="mt-4 p-4 rounded-xl border border-slate-800/60 bg-slate-900/30">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-slate-200 flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-electric-blue" />
                    Hybrid memory offload
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-xl">
                    Spreads <span className="font-mono text-slate-400">{state.hfModelId}</span> across GPU
                    VRAM and system RAM during optimization (
                    <code className="text-slate-400">device_map: auto</code>).
                  </p>
                  {!isMemoryOffloadAvailable(state) && (
                    <p className="text-[11px] text-amber-500/90 leading-relaxed">
                      Select <strong className="font-semibold">NVIDIA CUDA</strong>,{" "}
                      <strong className="font-semibold">TensorRT RTX</strong>,{" "}
                      <strong className="font-semibold">TensorRT</strong>, or{" "}
                      <strong className="font-semibold">AMD ROCm</strong> above to enable this toggle.
                      {hardwareProbe &&
                        isGpuProvider(hardwareProbe.recommendedProvider) &&
                        !isGpuProvider(state.ihvProvider) && (
                          <button
                            type="button"
                            onClick={() => setState({ ihvProvider: hardwareProbe.recommendedProvider })}
                            className="ml-2 text-electric-blue hover:text-white cursor-pointer underline underline-offset-2"
                          >
                            Switch to{" "}
                            {providers.find((p) => p.id === hardwareProbe.recommendedProvider)?.name}
                          </button>
                        )}
                    </p>
                  )}
                </div>
                <Switch
                  disabled={!isMemoryOffloadAvailable(state)}
                  checked={isMemoryOffloadAvailable(state) && state.memoryOffload === "auto"}
                  onCheckedChange={(checked) => setState({ memoryOffload: checked ? "auto" : "gpu_only" })}
                />
              </div>
            </div>
          )}

          {state.modelSource !== "huggingface" && isGpuProvider(state.ihvProvider) && (
            <p className="mt-4 text-[11px] text-slate-600 px-1">
              Hybrid memory offload needs a Hugging Face model in step 01 (Local/Azure sources are not
              supported).
            </p>
          )}

          {/* CUDA Version Override — only for GPU providers */}
          {(
            [
              "CUDAExecutionProvider",
              "NvTensorRTRTXExecutionProvider",
              "TensorrtExecutionProvider",
              "ROCMExecutionProvider",
            ] as IHVProvider[]
          ).includes(state.ihvProvider) && (
            <div className="mt-4">
              <div className="p-4 rounded-xl border border-slate-800/60 bg-slate-900/30">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-slate-200">PyTorch CUDA Version</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {hardwareProbe?.nvidia?.cudaTag ? (
                        <>
                          Probed: CUDA {hardwareProbe.nvidia.cudaVersion} (
                          <code className="text-emerald-400 bg-slate-800 px-1 py-0.5 rounded">
                            {hardwareProbe.nvidia.cudaTag}
                          </code>
                          ) via nvidia-smi. Override if wrong.
                        </>
                      ) : (
                        <>
                          Auto-detect reads{" "}
                          <code className="text-slate-400 bg-slate-800 px-1 py-0.5 rounded">nvidia-smi</code>{" "}
                          at execute time. Override if wrong toolkit version is picked.
                        </>
                      )}
                    </p>
                  </div>
                  <select
                    id="cuda-version-override"
                    aria-label="PyTorch CUDA Version"
                    value={state.cudaVersion ?? "auto"}
                    onChange={(e) => setState({ cudaVersion: e.target.value as UIState["cudaVersion"] })}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-electric-blue shrink-0 cursor-pointer"
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="cpu">CPU Only</option>
                    <option value="cu118">CUDA 11.8</option>
                    <option value="cu121">CUDA 12.1</option>
                    <option value="cu124">CUDA 12.4</option>
                    <option value="cu126">CUDA 12.6</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Optimization Passes Cross-Referencing Matrix */}
          <div className="mt-10 pt-8 border-t border-slate-800">
            {/* Header, Search Filter, and View Toggles */}
            <div className="flex flex-col gap-6 mb-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Activity className="h-4.5 w-4.5 text-electric-blue shrink-0" />
                    Pass ↔ Provider Compatibility Matrix
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                    Rule-based pass compatibility for each execution provider. Green cells mean the pass is
                    allowed on that backend; hardware availability is shown separately in the probe banner and
                    column headers.
                  </p>
                </div>

                {/* View Switch Segmented Control */}
                <div className="flex items-center bg-slate-950 p-1 border border-slate-800 rounded-lg self-start shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab("matrix")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                      activeTab === "matrix"
                        ? "bg-electric-blue text-white font-bold"
                        : "text-slate-400 hover:text-slate-205"
                    }`}
                  >
                    <Table className="h-3.5 w-3.5" />
                    Matrix View
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("cards")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                      activeTab === "cards"
                        ? "bg-electric-blue text-white font-bold"
                        : "text-slate-400 hover:text-slate-205"
                    }`}
                  >
                    <List className="h-3.5 w-3.5" />
                    Interactive Cards
                  </button>
                </div>
              </div>

              {/* Filtering Suite */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-900/35 p-4 rounded-xl border border-slate-800/60">
                {/* Text Search */}
                <div className="md:col-span-5 relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search compiler passes..."
                    value={passSearch}
                    onChange={(e) => setPassSearch(e.target.value)}
                    className="w-full h-9 bg-slate-950 border border-slate-800/80 rounded-lg pl-9 pr-4 text-xs font-medium text-slate-200 placeholder-slate-500 outline-none focus:border-electric-blue/50 focus:ring-1 focus:ring-electric-blue/30 transition-all font-sans"
                  />
                  {passSearch && (
                    <button
                      type="button"
                      onClick={() => setPassSearch("")}
                      className="absolute right-2.5 top-2 text-[10px] bg-slate-850 hover:bg-slate-700 text-slate-400 p-1 px-1.5 rounded cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Categories badges filter */}
                <div className="md:col-span-7 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono text-slate-500 uppercase font-black tracking-wider mr-1">
                    Filter:
                  </span>
                  {(["All", "Conversion", "Quantization", "Compression", "PEFT"] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1 rounded-full text-[10.5px] font-semibold tracking-tight transition-all cursor-pointer ${
                        selectedCategory === cat
                          ? "bg-electric-blue/15 border-electric-blue/40 text-electric-blue font-bold border"
                          : "bg-slate-950 hover:bg-slate-900 border border-slate-805 text-slate-400"
                      }`}
                    >
                      {cat === "All" ? "All Passes" : cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Empty state if search returns nothing */}
            {filteredValidations.length === 0 ? (
              <div className="text-center py-12 rounded-xl border border-dashed border-slate-800/80 bg-slate-900/5 mt-2 animate-in fade-in">
                <ShieldAlert className="h-10 w-10 text-slate-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-350">
                  No optimization passes match your filter criteria
                </p>
                <p className="text-xs text-slate-505 mt-1 max-w-md mx-auto">
                  Try clearing your search query or choosing "All Passes" to display the full compatibility
                  matrix.
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setPassSearch("");
                      setSelectedCategory("All");
                    }}
                    className="text-xs bg-electric-blue hover:bg-electric-blue-dark text-white font-bold p-2 px-4 rounded-lg cursor-pointer"
                  >
                    Reset Active Filters
                  </button>
                </div>
              </div>
            ) : activeTab === "matrix" ? (
              /* TAB 1: VALIDATION MATRIX INTERACTIVE HEATMAP */
              <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/25 mt-2 shadow-xl animate-in fade-in duration-300">
                <div className="overflow-x-auto">
                  <table
                    aria-label="Pass and execution provider compatibility matrix"
                    className="w-full text-left border-collapse min-w-[720px]"
                  >
                    <thead>
                      <tr className="border-b border-slate-800/80 bg-slate-900/30">
                        {/* Header Cell 1 */}
                        <th className="p-2 px-3 text-[10px] font-mono font-semibold tracking-wider text-slate-400 w-[200px]">
                          PASS
                        </th>

                        {/* Hardware target columns */}
                        {selectableProviders.map((p) => {
                          const isSelectedProvider = p.id === state.ihvProvider;
                          const HIcon = p.icon;
                          const detectedLocally = isProviderDetectedLocally(p.id, hardwareProbe);

                          return (
                            <th
                              key={p.id}
                              onClick={() => {
                                // Allow selecting undetected providers for cross-compile / remote targets
                                const detected = detectedProviders.includes(p.id);
                                if (!detected) {
                                  setState({ ihvProvider: p.id });
                                  return;
                                }
                                const patch = prepareProviderChange(state, p.id, hardwareProbe);
                                if (patch) {
                                  setState(patch);
                                }
                              }}
                              className={`p-2 px-1 text-center cursor-pointer transition-all relative select-none ${
                                isSelectedProvider
                                  ? "bg-electric-blue/10 border-l border-r border-t-2 border-t-electric-blue border-l-electric-blue/20 border-r-electric-blue/20"
                                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/30"
                              }`}
                            >
                              <div className="flex flex-col items-center justify-center gap-1 py-1">
                                <div
                                  className={`p-1 rounded border leading-none transition-all ${
                                    isSelectedProvider
                                      ? "bg-electric-blue/10 border-electric-blue/50 text-electric-blue"
                                      : "bg-slate-900 border-slate-800 text-slate-500"
                                  }`}
                                >
                                  <HIcon className="h-3 w-3" />
                                </div>
                                <span
                                  className={`text-[10px] font-mono font-semibold leading-none text-center ${
                                    isSelectedProvider
                                      ? "text-electric-blue"
                                      : detectedLocally
                                        ? "text-slate-400"
                                        : "text-slate-600"
                                  }`}
                                >
                                  {p.shortName}
                                </span>
                                {!detectedLocally && !probeLoading && (
                                  <span className="text-[7px] font-mono text-slate-600 uppercase tracking-wide leading-none">
                                    Absent
                                  </span>
                                )}
                                {detectedLocally && !isSelectedProvider && (
                                  <span className="text-[7px] font-mono text-emerald-600 uppercase tracking-wide leading-none">
                                    Local
                                  </span>
                                )}
                                {isSelectedProvider ? (
                                  <div className="flex items-center gap-1">
                                    <span className="flex h-1.5 w-1.5 relative">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                    </span>
                                    <span className="text-[8px] tracking-widest font-mono font-black uppercase text-electric-blue leading-none">
                                      Active
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[8px] font-mono text-slate-700 uppercase tracking-wider leading-none select-none hover:text-slate-400">
                                    Select
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>

                    <tbody>
                      {filteredValidations.map((v) => {
                        const isActiveOnSelected = v.isActive(state.passes);

                        return (
                          <tr
                            key={v.id}
                            className="border-b border-slate-900 hover:bg-slate-900/10 transition-colors"
                          >
                            {/* Column 1: Row Title and Category info */}
                            <td className="p-3 px-4 w-[min(100%,280px)] min-w-[220px] align-top">
                              <div className="space-y-2">
                                <span
                                  className={`inline-block text-[9px] font-mono uppercase px-2 py-0.5 rounded border tracking-wider font-bold ${
                                    v.category === "Conversion"
                                      ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                      : v.category === "Quantization"
                                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                        : v.category === "Compression"
                                          ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  }`}
                                >
                                  {v.category}
                                </span>
                                <p className="text-sm font-semibold text-slate-100 leading-snug pr-2">
                                  {v.name}
                                </p>
                                <p className="text-xs text-slate-400 leading-relaxed pr-2">{v.description}</p>
                              </div>
                            </td>

                            {/* Column 2-6: Dynamic hardware cells */}
                            {selectableProviders.map((p) => {
                              const isSelectedProvider = p.id === state.ihvProvider;
                              const comp = getCellCompatibility(v, p.id, state.passes);
                              const isCurrentlyActiveInCore = isSelectedProvider && isActiveOnSelected;

                              const handleCellClick = () => {
                                if (comp.status === "unsupported" || comp.status === "blocked") return;

                                if (isSelectedProvider) {
                                  const updated = v.toggle(state.passes, isActiveOnSelected);
                                  setState({ passes: { ...state.passes, ...updated } });
                                  return;
                                }

                                const patch = prepareProviderChange(state, p.id, hardwareProbe);
                                if (!patch) return;
                                const basePasses = patch.passes ?? state.passes;
                                const finalPasses = { ...basePasses, ...v.toggle(basePasses, false) };
                                setState({ ...patch, passes: finalPasses });
                              };

                              return (
                                <td
                                  key={p.id}
                                  onClick={handleCellClick}
                                  className={`p-2 text-center transition-all ${
                                    isSelectedProvider
                                      ? "bg-electric-blue/5 border-l border-r border-electric-blue/10"
                                      : "hover:bg-slate-900/30"
                                  } ${comp.status === "unsupported" || comp.status === "blocked" ? "cursor-not-allowed" : "cursor-pointer"}`}
                                >
                                  <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="inline-flex items-center justify-center p-1 cursor-help">
                                          {comp.status === "supported" ? (
                                            isCurrentlyActiveInCore ? (
                                              <div className="flex h-6 items-center gap-1 p-1 px-3 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10.5px] font-mono font-medium">
                                                <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />{" "}
                                                Active
                                              </div>
                                            ) : (
                                              <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 hover:border-emerald-500/40 hover:bg-emerald-500/10 flex items-center justify-center text-slate-500 hover:text-emerald-400 hover:scale-110 active:scale-90 transition-all">
                                                <Check className="h-3.5 w-3.5" />
                                              </div>
                                            )
                                          ) : comp.status === "partial" ? (
                                            isCurrentlyActiveInCore ? (
                                              <div className="flex h-6 items-center gap-1 p-1 px-3 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10.5px] font-mono font-medium">
                                                <AlertCircle className="h-3.5 w-3.5 text-amber-400" />{" "}
                                                Fallback
                                              </div>
                                            ) : (
                                              <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 hover:border-amber-500/40 hover:bg-amber-500/10 flex items-center justify-center text-slate-500 hover:text-amber-400 hover:scale-110 active:scale-90 transition-all">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                              </div>
                                            )
                                          ) : comp.status === "blocked" ? (
                                            <div className="h-6 w-6 rounded-full bg-amber-950/40 border border-amber-500/25 flex items-center justify-center text-amber-400/80">
                                              <AlertTriangle className="h-3 w-3" />
                                            </div>
                                          ) : (
                                            <div className="h-6 w-6 rounded-full bg-slate-950 border border-slate-900/60 flex items-center justify-center text-slate-700/60">
                                              <Lock className="h-3 w-3" />
                                            </div>
                                          )}
                                        </div>
                                      </TooltipTrigger>

                                      <TooltipContent
                                        side="top"
                                        className="max-w-[325px] bg-slate-950 border border-slate-800 text-slate-300 p-4 shadow-2xl leading-relaxed z-50"
                                      >
                                        <div className="space-y-3">
                                          <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                                            <span className="text-[9.5px] font-mono uppercase bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-800">
                                              {p.name.replace(" (Snapdragon)", "")}
                                            </span>
                                            <span
                                              className={`text-[9.5px] font-mono font-extrabold uppercase tracking-wider px-2 py-0.5 rounded leading-none ${
                                                comp.status === "supported"
                                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                  : comp.status === "partial"
                                                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                                    : "bg-rose-500/10 text-rose-450 border border-rose-500/20"
                                              }`}
                                            >
                                              {comp.label}
                                            </span>
                                          </div>

                                          <div className="space-y-1">
                                            <p className="text-[11.5px] font-mono font-bold text-electric-blue uppercase tracking-wide">
                                              {v.name}
                                            </p>
                                            <p className="text-slate-400 text-xs leading-relaxed">
                                              {comp.reason}
                                            </p>
                                          </div>

                                          {/* Estimated heuristics — not measured on this machine */}
                                          <div className="grid grid-cols-3 gap-1.5 border-t border-slate-900 pt-3">
                                            <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                              <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                                Est. speed
                                              </span>
                                              <span
                                                className={`text-xs font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-350"}`}
                                              >
                                                {comp.speedup}
                                              </span>
                                            </div>
                                            <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                              <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                                Est. VRAM
                                              </span>
                                              <span
                                                className={`text-xs font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-350"}`}
                                              >
                                                {comp.vram}
                                              </span>
                                            </div>
                                            <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                              <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                                Heuristic
                                              </span>
                                              <span
                                                className={`text-xs font-black block ${comp.status === "supported" ? "text-electric-blue" : "text-slate-350"}`}
                                              >
                                                {comp.efficiency}
                                              </span>
                                            </div>
                                          </div>

                                          <div className="text-[10px] text-slate-500 font-sans border-t border-slate-900 pt-2.5 leading-snug">
                                            {comp.status === "unsupported"
                                              ? `${v.name} is completely incompatible with the target instruction architecture.`
                                              : isSelectedProvider
                                                ? `Click this column cell directly to toggle the ${v.name} pass ${isCurrentlyActiveInCore ? "OFF" : "ON"}.`
                                                : `Click to set acceleration to ${p.name} and configure this pipeline pass.`}
                                          </div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Matrix Footer Legend */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t border-slate-900 bg-slate-900/20 text-[11px] text-slate-400">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-xs text-slate-500">Legend</span>
                    <span className="flex items-center gap-1.5 font-sans">
                      <span className="h-3.5 w-3.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
                        <Check className="h-2 w-2" />
                      </span>
                      Optimized Acceleration Available
                    </span>
                    <span className="flex items-center gap-1.5 font-sans">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      CPU Fallback Emulation Modality
                    </span>
                    <span className="flex items-center gap-1.5 font-sans">
                      <Lock className="h-3 w-3 text-slate-500" />
                      Incompatible / Blocked on Chipset
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10.5px] font-mono bg-slate-800/40 text-slate-400 border border-slate-700/60 p-1 px-2.5 rounded">
                    {hardwareProbe
                      ? `Hardware probed ${new Date(hardwareProbe.probedAt).toLocaleTimeString()} · pass rules + local EP detection`
                      : "Client-side compatibility rules"}
                  </div>
                </div>
              </div>
            ) : (
              /* TAB 2: DETAILED INTERACTIVE SHOWN CARDS */
              <TooltipProvider delayDuration={150}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 animate-in fade-in">
                  {filteredValidations.map((v) => {
                    const isUnsupportedOnCurrent = v.isUnsupported(state.ihvProvider);
                    const configBlock =
                      v.id === "awq-quantization"
                        ? getQuantMethodActivationBlock("awq", state.passes, state.ihvProvider)
                        : v.id === "qat-quantization"
                          ? getQuantMethodActivationBlock("qat", state.passes, state.ihvProvider)
                          : null;
                    const isBlockedByConfig = !isUnsupportedOnCurrent && configBlock !== null;
                    const isActiveState = v.isActive(state.passes);
                    const reason = v.getIncompatibilityReason(state.ihvProvider);
                    const toggleDisabled = isUnsupportedOnCurrent || isBlockedByConfig;

                    return (
                      <div
                        key={v.id}
                        className={`flex flex-col justify-between p-4.5 rounded-xl border transition-all relative overflow-hidden ${
                          isUnsupportedOnCurrent || isBlockedByConfig
                            ? "bg-slate-950/40 border-slate-900/60 opacity-40 shadow-none hover:border-slate-800/40"
                            : isActiveState
                              ? "bg-electric-blue/5 border-electric-blue/40 shadow-[0_2px_12px_rgba(59,130,246,0.02)] hover:border-electric-blue/60"
                              : "bg-slate-900/30 border-slate-800/80 hover:bg-slate-900/65 hover:border-slate-700"
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-2">
                              <span
                                className={`inline-block text-[9px] uppercase font-mono px-2 py-0.5 rounded border tracking-wider font-bold ${
                                  v.category === "Conversion"
                                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                    : v.category === "Quantization"
                                      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                      : v.category === "Compression"
                                        ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                }`}
                              >
                                {v.category}
                              </span>
                              <h5
                                className={`text-sm font-semibold leading-snug ${
                                  isUnsupportedOnCurrent ? "text-slate-500" : "text-slate-100"
                                }`}
                              >
                                {v.name}
                              </h5>
                            </div>

                            {isUnsupportedOnCurrent ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help shrink-0 p-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 leading-none">
                                    <Lock className="h-3 w-3" /> Incompatible
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="max-w-[280px] bg-slate-950 border border-slate-800 text-slate-300 p-3 shadow-xl leading-relaxed"
                                >
                                  <div className="space-y-1">
                                    <p className="font-bold text-rose-400 flex items-center gap-1 text-xs">
                                      <AlertCircle className="h-3.5 w-3.5" /> Hardware Incompatibility
                                    </p>
                                    <p className="text-slate-200 font-semibold">{reason}</p>
                                    <p className="text-slate-450 border-t border-slate-900 pt-1 mt-1 text-[11px] font-sans leading-normal">
                                      {v.requiresExplanation}
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : isBlockedByConfig ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help shrink-0 p-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 leading-none">
                                    <AlertTriangle className="h-3 w-3" /> Blocked
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="max-w-[280px] bg-slate-950 border border-slate-800 text-slate-300 p-3 shadow-xl leading-relaxed"
                                >
                                  <div className="space-y-1">
                                    <p className="font-bold text-amber-400 flex items-center gap-1 text-xs">
                                      <AlertCircle className="h-3.5 w-3.5" /> Active pipeline conflict
                                    </p>
                                    <p className="text-slate-200 font-semibold">{configBlock?.reason}</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span
                                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border flex items-center gap-1 leading-none shrink-0 ${
                                  isActiveState
                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                    : "bg-slate-850/40 border-slate-800 text-slate-500"
                                }`}
                              >
                                {isActiveState ? (
                                  <>
                                    <CheckCircle className="h-3 w-3" /> Enabled
                                  </>
                                ) : (
                                  "Inactive"
                                )}
                              </span>
                            )}
                          </div>

                          <p
                            className={`text-xs text-slate-400 leading-relaxed ${isUnsupportedOnCurrent ? "text-slate-600" : ""}`}
                          >
                            {v.description}
                          </p>
                          <p className="text-[11px] text-slate-500 leading-relaxed border-l border-slate-800 pl-3">
                            <span className="text-slate-400 font-medium">Note: </span>
                            {v.requiresExplanation}
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-900/60 flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-500 font-medium">
                            {isUnsupportedOnCurrent
                              ? v.id === "awq-quantization"
                                ? "Requires CUDA, TensorRT, or ROCm — switch hardware target above"
                                : "Pass locked on current backend"
                              : isBlockedByConfig
                                ? "Resolve the conflict in Optimization passes first"
                                : `Direct toggle on ${providers.find((p) => p.id === state.ihvProvider)?.name}`}
                          </span>
                          <Switch
                            disabled={toggleDisabled}
                            checked={toggleDisabled ? false : isActiveState}
                            onCheckedChange={(checked) => {
                              if (toggleDisabled) return;
                              const updated = v.toggle(state.passes, !checked);
                              setState({ passes: { ...state.passes, ...updated } });
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TooltipProvider>
            )}
          </div>

          {/* Vendor Specific Flags - Show dynamically based on selection */}
          <div className="mt-8 pt-6 border-t border-slate-800">
            <h4 className="text-sm font-medium mb-4 text-slate-300 flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Target Specific Flags
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {state.ihvProvider === "TensorrtExecutionProvider" ||
              state.ihvProvider === "CUDAExecutionProvider" ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Use fp16</Label>
                      <p className="text-xs text-slate-500">Enable Tensor Core math.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Enable TensorRT Graph Optimizations</Label>
                      <p className="text-xs text-slate-500">Build TensorRT engines dynamically.</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                </>
              ) : state.ihvProvider === "OpenVINOExecutionProvider" ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="openvino-target-device">Target Device</Label>
                      <p className="text-xs text-slate-500">CPU, GPU, NPU</p>
                    </div>
                    <Select
                      id="openvino-target-device"
                      aria-label="Target Device"
                      className="w-full max-w-[150px]"
                    >
                      <option>NPU</option>
                      <option>CPU</option>
                      <option>GPU</option>
                    </Select>
                  </div>
                </>
              ) : (
                <div className="col-span-2 text-sm text-slate-500 py-2">
                  No advanced configuration required for the standard execution provider.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
