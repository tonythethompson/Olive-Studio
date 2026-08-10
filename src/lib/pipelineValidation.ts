import { IHVProvider, ModelSource, UIState, OliveRecipe } from "@/types";
import { isMemoryOffloadAvailable } from "@/lib/memoryOffload";
import { getProviderAvailabilityBlock, type HardwareProbeResult } from "@/lib/hardwareProbe";
import { buildOliveRecipe, isPyTorchNativeQuantMethod, hasOnnxGraphProducer } from "@/lib/oliveRecipeBuilder";
import { REPLACEMENT_PIPELINE_SUPPRESSED_PASSES, isReplacementExportPipeline } from "@/lib/replacementExportPipeline";
import { assessQnnRecipeReadiness, isQnnIhvProvider, type QnnReadinessIssue } from "@/lib/qnnReadiness";
import { isKnownPass, getPassSchema } from "@/lib/schemaEngine";
import { pickOpenVinoTargetFromDevices } from "@/lib/openvinoDeps";
import {
  isExportTargetProvider,
  isLegacyExportProvider,
  isPlatformLocalProvider,
  PEFT_UNSUPPORTED_PROVIDERS,
} from "@/lib/providerRuntimeKind";

export type PipelineValidationOptions = {
  hardwareProbe?: HardwareProbeResult | null;
  /** Block browser-only EPs from local Olive runs (Execute Live / batch queue). */
  forLocalExecution?: boolean;
};

export type IssueSeverity = "critical" | "warning" | "info";

export interface PipelineIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  affectedTabs?: string[];
  /** Graph node IDs (pipeline step ids) affected — drives per-node conflict badges */
  affectedPasses?: string[];
  actionLabel?: string;
  autofix?: Partial<UIState>;
}

export interface PipelineValidationResult {
  issues: PipelineIssue[];
  criticalCount: number;
  warningCount: number;
  isBlocked: boolean;
  statusLabel: string;
  statusTone: "success" | "warning" | "error";
  /** Pre-built recipe, available for reuse to avoid redundant builds */
  recipe: OliveRecipe;
}

export interface HardwareConflict {
  passKey: string;
  passName: string;
  reason: string;
  severity: IssueSeverity;
  autofix: () => Partial<UIState["passes"]>;
}

const GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
];
const TENSOR_CORE_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
];

/**
 * Determines whether a quantization method is supported by an execution provider.
 *
 * @param method - The quantization method to check
 * @param provider - The execution provider to check
 * @returns `true` if the method is supported by the provider, `false` otherwise
 */

export function isQuantMethodAllowed(
  method: UIState["passes"]["quantMethod"],
  provider: IHVProvider,
): boolean {
  if (method === "awq") {
    return GPU_PROVIDERS.includes(provider);
  }
  if (method === "gptq") {
    return GPU_PROVIDERS.includes(provider);
  }
  if (method === "qat") {
    return provider !== "QNNExecutionProvider" && provider !== "QnnAbiExecutionProvider";
  }
  if (method === "hqq" || method === "rtn" || method === "kquant") {
    // OnnxHqqQuantization, OnnxBlockWiseRtnQuantization, and KQuant/OnnxKquantQuantization only support CPU/CUDA.
    return provider === "CPUExecutionProvider" || provider === "CUDAExecutionProvider";
  }
  if (method === "spinquant" || method === "quarot") {
    return GPU_PROVIDERS.includes(provider);
  }
  return true;
}

/** Why a quant method toggle would not stick after commit (beyond EP hardware rules). */
export function getQuantMethodActivationBlock(
  method: Extract<UIState["passes"]["quantMethod"], "awq" | "gptq" | "qat" | "hqq" | "spinquant" | "quarot">,
  passes: UIState["passes"],
  provider: IHVProvider,
): { reason: string } | null {
  if (!isQuantMethodAllowed(method, provider)) {
    return null;
  }
  if (method === "qat" && passes.splitting) {
    return {
      reason: "QAT conflicts with model splitting. Disable splitting first, or use PTQ/AWQ instead.",
    };
  }
  return null;
}

export function isConversionFormatAllowed(
  format: UIState["passes"]["conversionFormat"],
  provider: IHVProvider,
): boolean {
  if (format === "openvino") {
    return provider === "OpenVINOExecutionProvider";
  }
  return true;
}

export function isStructuredPruningAllowed(provider: IHVProvider): boolean {
  return TENSOR_CORE_PROVIDERS.includes(provider);
}

export function isPeftAllowed(provider: IHVProvider): boolean {
  return !PEFT_UNSUPPORTED_PROVIDERS.includes(provider);
}

export function isPeftMethodAllowed(method: UIState["passes"]["peftMethod"], provider: IHVProvider): boolean {
  if (method === "qlora") {
    return GPU_PROVIDERS.includes(provider);
  }
  return true;
}

export function getProviderConflicts(providerId: IHVProvider, passes: UIState["passes"]): HardwareConflict[] {
  const conflicts: HardwareConflict[] = [];

  const add = (active: boolean, conflict: HardwareConflict) => {
    if (active) conflicts.push(conflict);
  };

  add(
    passes.conversion &&
    passes.conversionFormat === "openvino" &&
    !isConversionFormatAllowed("openvino", providerId),
    {
      passKey: "conversionFormat",
      passName: "OpenVINO IR Conversion",
      reason: "OpenVINO IR requires the Intel OpenVINO execution provider.",
      severity: "critical",
      autofix: () => ({ conversionFormat: "onnx" }),
    },
  );

  add(passes.quantization && passes.quantMethod === "awq" && !isQuantMethodAllowed("awq", providerId), {
    passKey: "quantMethod",
    passName: "AWQ Quantization",
    reason: "AWQ requires NVIDIA CUDA, TensorRT, or AMD ROCm GPU acceleration.",
    severity: "critical",
    autofix: () => ({ quantMethod: "ptq" }),
  });

  add(passes.quantization && passes.quantMethod === "gptq" && !isQuantMethodAllowed("gptq", providerId), {
    passKey: "quantMethod",
    passName: "GPTQ Quantization",
    reason: "GPTQ requires NVIDIA CUDA, TensorRT, or AMD ROCm GPU acceleration for calibration.",
    severity: "critical",
    autofix: () => ({ quantMethod: "ptq" }),
  });

  add(passes.quantization && passes.quantMethod === "qat" && !isQuantMethodAllowed("qat", providerId), {
    passKey: "quantMethod",
    passName: "Quantization-Aware Training (QAT)",
    reason: "QAT training pipelines are not supported on Qualcomm QNN NPUs.",
    severity: "critical",
    autofix: () => ({ quantMethod: "ptq" }),
  });

  add(passes.quantization && passes.quantMethod === "hqq" && !isQuantMethodAllowed("hqq", providerId), {
    passKey: "quantMethod",
    passName: "HQQ Quantization",
    reason: "HQQ requires GPU acceleration — not available on CPU.",
    severity: "critical",
    autofix: () => ({ quantMethod: "ptq" }),
  });

  add(passes.quantization && passes.quantMethod === "kquant" && !isQuantMethodAllowed("kquant", providerId), {
    passKey: "quantMethod",
    passName: "KQuant Quantization",
    reason: "KQuant (ggml-style) requires CPU or CUDA — not supported on QNN, OpenVINO, or other providers.",
    severity: "critical",
    autofix: () => ({ quantMethod: "ptq" }),
  });

  add(
    passes.quantization &&
    (passes.quantMethod === "spinquant" || passes.quantMethod === "quarot") &&
    !isQuantMethodAllowed(passes.quantMethod, providerId),
    {
      passKey: "quantMethod",
      passName: passes.quantMethod === "spinquant" ? "SpinQuant Quantization" : "QuaRot Quantization",
      reason:
        passes.quantMethod === "spinquant"
          ? "SpinQuant requires NVIDIA CUDA, TensorRT, or AMD ROCm GPU acceleration."
          : "QuaRot requires NVIDIA CUDA, TensorRT, or AMD ROCm GPU acceleration.",
      severity: "critical",
      autofix: () => ({ quantMethod: "ptq" }),
    },
  );

  add(passes.pruning && passes.pruningType === "structured" && !isStructuredPruningAllowed(providerId), {
    passKey: "pruningType",
    passName: "Structured 2:4 Sparsity",
    reason: "Structured sparsity requires NVIDIA CUDA or TensorRT tensor-core hardware.",
    severity: "warning",
    autofix: () => ({ pruningType: "unstructured" }),
  });

  add(passes.peft && !isPeftAllowed(providerId), {
    passKey: "peft",
    passName: "PEFT / LoRA Training",
    reason:
      providerId === "QNNExecutionProvider" || providerId === "QnnAbiExecutionProvider"
        ? "Snapdragon QNN targets are inference-only and cannot run PEFT training loops."
        : "Intel OpenVINO targets are inference-only; PEFT training requires CUDA or ROCm.",
    severity: providerId === "QNNExecutionProvider" || providerId === "QnnAbiExecutionProvider" ? "critical" : "warning",
    autofix: () => ({ peft: false }),
  });

  add(passes.peft && !isPeftMethodAllowed(passes.peftMethod, providerId), {
    passKey: "peftMethod",
    passName: "QLoRA Tuning",
    reason: "QLoRA requires NVIDIA CUDA, TensorRT, or AMD ROCm GPU kernels.",
    severity: providerId === "CPUExecutionProvider" ? "warning" : "critical",
    autofix: () => ({ peftMethod: "lora" }),
  });

  add(passes.peft && providerId === "CPUExecutionProvider" && passes.peftMethod === "lora", {
    passKey: "peft",
    passName: "PEFT / LoRA Training",
    reason: "LoRA fine-tuning on CPU-only hosts is impractical and not a realistic deployment target.",
    severity: "warning",
    autofix: () => ({ peft: false }),
  });

  return conflicts;
}

/** Apply all provider-specific conflict autofixes for a target EP. */
export function applyProviderConflictAutofixes(
  providerId: IHVProvider,
  passes: UIState["passes"],
): UIState["passes"] {
  let updated: UIState["passes"] = { ...passes };
  for (const conflict of getProviderConflicts(providerId, passes)) {
    updated = { ...updated, ...conflict.autofix() };
  }
  return coercePassFields(updated, providerId);
}

export function isProviderCompatibleWithPasses(providerId: IHVProvider, passes: UIState["passes"]): boolean {
  return getProviderConflicts(providerId, passes).every((c) => c.severity !== "critical");
}

export function hasProviderCriticalConflicts(providerId: IHVProvider, passes: UIState["passes"]): boolean {
  return getProviderConflicts(providerId, passes).some((c) => c.severity === "critical");
}

/** Providers absent from the local hardware probe cannot be selected or run. */
export function getProviderHardwareBlock(
  providerId: IHVProvider,
  probe: HardwareProbeResult | null | undefined,
): { reason: string } | null {
  return getProviderAvailabilityBlock(providerId, probe);
}

export function getProviderSelectionBlockReason(
  providerId: IHVProvider,
  _passes: UIState["passes"],
  probe?: HardwareProbeResult | null,
): string | null {
  return getProviderHardwareBlock(providerId, probe)?.reason ?? null;
}

/** Apply provider switch with pass autofixes; returns null when the target is blocked. */
export function prepareProviderChange(
  state: UIState,
  providerId: IHVProvider,
  probe?: HardwareProbeResult | null,
  options?: { skipHardwareBlock?: boolean },
): Partial<UIState> | null {
  if (!options?.skipHardwareBlock) {
    // Standard hardware block (local providers not in detectedProviders).
    if (getProviderHardwareBlock(providerId, probe)) {
      return null;
    }
    // PlatformLocal providers bypass getProviderAvailabilityBlock (always selectable in UI),
    // but prepareProviderChange should still block switching to them when not detected
    // and the host cannot support them (e.g. QNN on Linux).
    if (
      isPlatformLocalProvider(providerId) &&
      probe &&
      !probe.detectedProviders.includes(providerId)
    ) {
      return null;
    }
  }

  const conflicts = getProviderConflicts(providerId, state.passes);
  const hasCritical = conflicts.some((c) => c.severity === "critical");

  return {
    ihvProvider: providerId,
    ...(providerId === "OpenVINOExecutionProvider"
      ? {
        openvinoTargetDevice: pickOpenVinoTargetFromDevices(probe?.openvino?.devices),
      }
      : {}),
    ...(hasCritical
      ? { passes: applyProviderConflictAutofixes(providerId, state.passes) }
      : {}),
  };
}

function passesNeedOnnxGraph(passes: UIState["passes"]): boolean {
  if (isReplacementExportPipeline(passes)) return false;
  // PyTorch-native quantizers do not need an ONNX conversion by themselves.
  // They only need conversion when followed by ONNX graph transforms or splitting.
  const usesPyTorchQuant = passes.quantization && isPyTorchNativeQuantMethod(passes.quantMethod);
  if (usesPyTorchQuant) {
    return Boolean(passes.onnxTransforms || passes.splitting);
  }
  return Boolean(passes.quantization || passes.onnxTransforms || passes.splitting);
}

/**
 * Single source of truth for cross-pass compatibility. Each rule describes one
 * invalid pass combination and the patch that resolves it. Rules with
 * `autoCoerce` are silently fixed on every state commit (`coercePassFields`);
 * every rule also surfaces as an issue when the state still violates it
 * (`getCrossPassIssues`), so coercion and validation cannot drift apart.
 *
 * Rule order is significant: sanitizePipelineState fixes the first fixable
 * critical issue, and coercions apply in table order.
 */
interface CrossPassRule {
  id: string;
  /** True while the invalid combination exists. */
  applies: (passes: UIState["passes"], provider: IHVProvider) => boolean;
  /** Pass patch that resolves the conflict (also used as the issue autofix). */
  fix: Partial<UIState["passes"]>;
  /** True: silently applied at commit time. False: the user decides. */
  autoCoerce: boolean;
  severity: IssueSeverity;
  title: string;
  description: string;
  affectedTabs: string[];
  affectedPasses: string[];
  actionLabel: string;
}

const CROSS_PASS_RULES: CrossPassRule[] = [
  {
    id: "onnx-pipeline-missing-conversion",
    applies: (passes) => passesNeedOnnxGraph(passes) && !passes.conversion,
    fix: { conversion: true, conversionFormat: "onnx" },
    autoCoerce: false,
    severity: "critical",
    title: "ONNX conversion required",
    description:
      "ORT graph transforms and ONNX quantization operate on an ONNX graph. Enable Graph Conversion before these passes, especially for QNN and OpenVINO deployment targets.",
    affectedTabs: ["conversion", "transforms", "quantization"],
    affectedPasses: ["conversion", "transformer_opt", "quantization", "provider"],
    actionLabel: "Enable ONNX conversion",
  },
  {
    id: "peft-lora-quant",
    applies: (passes) =>
      passes.peft && passes.quantization && passes.quantPrecision !== "fp16" && passes.peftMethod === "lora",
    fix: { peftMethod: "qlora" },
    autoCoerce: true,
    severity: "critical",
    title: "LoRA Adapters active with base Quantization",
    description:
      "Standard LoRA expects floating-point base parameters to optimize. If you use integers (INT4/INT8), you must select QLoRA's double-quantized parameters.",
    affectedTabs: ["quantization", "peft"],
    affectedPasses: ["peft", "quantization"],
    actionLabel: "Enable QLoRA Mode",
  },
  {
    id: "pruning-int4-collapse",
    applies: (passes) => passes.pruning && passes.quantization && passes.quantPrecision === "int4",
    fix: { quantPrecision: "int8" },
    autoCoerce: true,
    severity: "warning",
    title: "INT4 & Sparsity Double Compress",
    description:
      "Applying both sparsity pruning and aggressive INT4 quantization leads to extreme mathematical precision decline and accuracy degradation.",
    affectedTabs: ["quantization", "compression"],
    affectedPasses: ["pruning", "quantization"],
    actionLabel: "Increase Quant to INT8",
  },
  {
    id: "openvino-onnx-transforms-clash",
    applies: (passes) => passes.conversion && passes.conversionFormat === "openvino" && passes.onnxTransforms,
    fix: { onnxTransforms: false },
    autoCoerce: true,
    severity: "warning",
    title: "Redundant Transforms with OpenVINO IR",
    description:
      "Manual ONNX graph layout transforms are redundant and can clash during subsequent compilation into OpenVINO XML representation.",
    affectedTabs: ["conversion", "transforms"],
    affectedPasses: ["conversion", "transformer_opt"],
    actionLabel: "Deactivate ONNX Transforms",
  },
  {
    id: "splitting-qat-conflict",
    applies: (passes) => passes.splitting && passes.quantization && passes.quantMethod === "qat",
    fix: { splitting: false },
    autoCoerce: true,
    severity: "critical",
    title: "Splitting + QAT Incompatibility",
    description:
      "Model splitting breaks the weights dictionary across boundary subroutines. QAT fine-tuning requires unbroken parameters.",
    affectedTabs: ["conversion", "quantization"],
    affectedPasses: ["splitting", "quantization"],
    actionLabel: "Disable Model Splitting",
  },
  {
    id: "cpu-qlora-mismatch",
    applies: (passes, provider) =>
      passes.peft && passes.peftMethod === "qlora" && provider === "CPUExecutionProvider",
    fix: { peftMethod: "lora" },
    autoCoerce: false,
    severity: "warning",
    title: "Inefficient PEFT Stage: QLoRA on CPU",
    description:
      "QLoRA gradients expect specialized GPU CUDA kernels. Training adapters on standard CPU threads is highly inefficient and slow.",
    affectedTabs: ["peft"],
    affectedPasses: ["peft"],
    actionLabel: "Revert PEFT to floating-point LoRA",
  },
  {
    id: "openvino-ep-mismatch",
    applies: (passes, provider) =>
      passes.conversion && passes.conversionFormat === "openvino" && provider !== "OpenVINOExecutionProvider",
    fix: { conversionFormat: "onnx" },
    autoCoerce: false,
    severity: "critical",
    title: "OpenVINO IR with incompatible execution provider",
    description:
      "OpenVINO conversion format is selected, but the target hardware is not Intel OpenVINO. Pipeline execution will fail.",
    affectedTabs: ["conversion"],
    affectedPasses: ["conversion", "provider"],
    actionLabel: "Switch conversion to ONNX",
  },
  {
    id: "qairt-discrepancy-incompatible",
    applies: (passes) => passes.onnxDiscrepancyCheck && passes.qairtPipeline,
    fix: { onnxDiscrepancyCheck: false },
    autoCoerce: true,
    severity: "critical",
    title: "OnnxDiscrepancyCheck incompatible with QairtPipeline",
    description:
      "QairtPipeline does not produce an ONNX graph, so OnnxDiscrepancyCheck cannot run. Disable discrepancy checking when using QairtPipeline.",
    affectedTabs: ["validation"],
    affectedPasses: ["onnxDiscrepancyCheck", "qairtPipeline"],
    actionLabel: "Disable OnnxDiscrepancyCheck",
  },
  {
    id: "onnx-discrepancy-missing-producer",
    applies: (passes) =>
      passes.onnxDiscrepancyCheck && !hasOnnxGraphProducer(passes) && !passes.qairtPipeline,
    fix: { conversion: true, conversionFormat: "onnx" },
    autoCoerce: false,
    severity: "critical",
    title: "OnnxDiscrepancyCheck requires an ONNX-producing pass",
    description:
      "OnnxDiscrepancyCheck compares ONNX model outputs against a reference. Enable ONNX conversion or MobiusBuilder before this validation pass.",
    affectedTabs: ["conversion", "validation"],
    affectedPasses: ["onnxDiscrepancyCheck", "conversion"],
    actionLabel: "Enable ONNX conversion",
  },
  {
    id: "qairt-pipeline-requires-qnn",
    applies: (passes, provider) =>
      passes.qairtPipeline &&
      provider !== "QNNExecutionProvider" &&
      (provider as string) !== "QnnAbiExecutionProvider",
    fix: { qairtPipeline: false },
    autoCoerce: true,
    severity: "critical",
    title: "QairtPipeline requires QNN execution provider",
    description:
      "QairtPipeline is a QNN-only pass that compiles models for Qualcomm Snapdragon NPUs. It requires QNNExecutionProvider or QnnAbiExecutionProvider.",
    affectedTabs: ["quantization"],
    affectedPasses: ["qairtPipeline", "provider"],
    actionLabel: "Disable QairtPipeline",
  },
  {
    id: "simplified-layernorm-requires-qnn",
    applies: (passes, provider) =>
      passes.simplifiedLayerNormToRMSNorm &&
      provider !== "QNNExecutionProvider" &&
      (provider as string) !== "QnnAbiExecutionProvider",
    fix: { simplifiedLayerNormToRMSNorm: false },
    autoCoerce: true,
    severity: "critical",
    title: "SimplifiedLayerNormToRMSNorm requires QNN",
    description:
      "SimplifiedLayerNormToRMSNorm is a QNN-targeted graph surgery that converts SimplifiedLayerNorm nodes to RMSNorm for Snapdragon NPU compatibility. Requires QNNExecutionProvider or QnnAbiExecutionProvider.",
    affectedTabs: ["transforms"],
    affectedPasses: ["simplifiedLayerNormToRMSNorm", "provider"],
    actionLabel: "Disable SimplifiedLayerNormToRMSNorm",
  },
  {
    id: "mobius-builder-incompatible-qnn",
    applies: (passes, provider) =>
      passes.mobiusBuilder &&
      (provider === "QNNExecutionProvider" || (provider as string) === "QnnAbiExecutionProvider"),
    fix: { mobiusBuilder: false },
    autoCoerce: true,
    severity: "critical",
    title: "MobiusBuilder incompatible with QNN",
    description:
      "MobiusBuilder produces ORT GenAI composite packages targeting CPU/CUDA. The ONNX GenAI runtime package does not target Qualcomm NPU hardware.",
    affectedTabs: ["conversion"],
    affectedPasses: ["mobiusBuilder", "provider"],
    actionLabel: "Disable MobiusBuilder",
  },
];

function getCrossPassIssues(state: UIState): PipelineIssue[] {
  return CROSS_PASS_RULES.filter((rule) => rule.applies(state.passes, state.ihvProvider)).map((rule) => ({
    id: rule.id,
    severity: rule.severity,
    title: rule.title,
    description: rule.description,
    affectedTabs: rule.affectedTabs,
    affectedPasses: rule.affectedPasses,
    actionLabel: rule.actionLabel,
    autofix: { passes: { ...state.passes, ...rule.fix } },
  }));
}

const PASS_KEY_TO_NODE: Record<string, string> = {
  conversionFormat: "conversion",
  quantMethod: "quantization",
  quantPrecision: "quantization",
  pruningType: "pruning",
  peft: "peft",
  peftMethod: "peft",
};

function getProviderIssues(state: UIState): PipelineIssue[] {
  return getProviderConflicts(state.ihvProvider, state.passes).map((c) => ({
    id: `provider-${state.ihvProvider}-${c.passKey}`,
    severity: c.severity,
    title: `${c.passName} incompatible with ${state.ihvProvider.replace("ExecutionProvider", "")}`,
    description: c.reason,
    affectedPasses: [PASS_KEY_TO_NODE[c.passKey] ?? c.passKey, "provider"].filter(Boolean),
    actionLabel: "Apply suggested fix",
    autofix: { passes: { ...state.passes, ...c.autofix() } },
  }));
}

function getProviderHardwareIssues(state: UIState, probe?: HardwareProbeResult | null): PipelineIssue[] {
  if (!probe) {
    return [];
  }

  const block = getProviderHardwareBlock(state.ihvProvider, probe);
  if (!block) {
    return [];
  }

  const shortName = state.ihvProvider.replace("ExecutionProvider", "");
  return [
    {
      id: `provider-hardware-${state.ihvProvider}`,
      severity: "critical",
      title: `${shortName} not available on this machine`,
      description: block.reason,
      affectedPasses: ["provider"],
      actionLabel: "Use detected hardware",
      autofix: { ihvProvider: probe.recommendedProvider },
    },
  ];
}

function qnnReadinessSeverityToPipeline(severity: QnnReadinessIssue["severity"]): IssueSeverity {
  switch (severity) {
    case "error":
      return "critical";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default: {
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}

function extractRecipeIoConfig(recipe: OliveRecipe): unknown {
  const inputModel = recipe.input_model as { io_config?: unknown } | undefined;
  return inputModel?.io_config;
}

/**
 * Maps QNN HTP / host-mode readiness into pipeline issues so Execute Live
 * and recipe validation honor fail-closed + dynamic-shape gates.
 */
function getQnnRecipeReadinessIssues(
  state: UIState,
  recipe: OliveRecipe,
  probe?: HardwareProbeResult | null,
): PipelineIssue[] {
  if (!isQnnIhvProvider(state.ihvProvider)) return [];

  return assessQnnRecipeReadiness({
    state,
    probe,
    ioConfig: extractRecipeIoConfig(recipe),
    platform: probe?.platform
      ? { platform: probe.platform.os, arch: probe.platform.arch }
      : undefined,
  }).map((issue) => ({
    id: `qnn-readiness-${issue.code}`,
    severity: qnnReadinessSeverityToPipeline(issue.severity),
    title: `QNN readiness: ${issue.code.replace(/_/g, " ")}`,
    description: issue.message,
    affectedPasses: ["provider"],
  }));
}

function inputModelFormats(inputModel: { type?: string }): string[] {
  switch (inputModel.type) {
    case "HfModel":
      return ["hf"];
    case "OnnxModel":
      return ["onnx"];
    case "OpenVINOModel":
      return ["openvino"];
    case "PyTorchModel":
    default:
      return ["torch"];
  }
}

/**
 * Detect input/output handler mismatches in the generated Olive pass chain.
 */
function getPassChainIssues(state: UIState, recipe: OliveRecipe): PipelineIssue[] {
  const issues: PipelineIssue[] = [];

  const recipePasses = recipe.passes ?? {};
  const passEntries = Object.entries(recipePasses);
  if (passEntries.length === 0) return issues;

  let prevOutputs = inputModelFormats(recipe.input_model ?? { type: "PyTorchModel" });
  let prevPassKey = "input_model";

  for (const [stepId, passConfig] of passEntries) {
    const passType = (passConfig as { type?: string }).type;
    if (!passType) continue;

    if (
      isReplacementExportPipeline(state.passes) &&
      (passType === "OnnxConversion" ||
        passType === "OpenVINOConversion" ||
        passType === "QNNConversion" ||
        passType === "TensorRTConversion")
    ) {
      continue;
    }

    const schema = getPassSchema(passType);
    if (!schema) continue;

    const inputs = schema.inputs ?? [];
    const outputs = schema.outputs ?? [];

    const compatible =
      inputs.length === 0 || prevOutputs.length === 0 || prevOutputs.some((o) => inputs.includes(o));
    if (!compatible) {
      issues.push({
        id: `pass-chain-mismatch-${stepId}`,
        severity: "critical",
        title: "Pass chain mismatch",
        description: `Previous step (${prevPassKey}) produces ${prevOutputs.join("/")} output, but ${passType} (${stepId}) expects inputs in ${inputs.join("/")} format.`,
        affectedTabs: [stepId],
        affectedPasses: [prevPassKey, stepId],
      });
    }

    prevOutputs = outputs.length > 0 ? outputs : prevOutputs;
    prevPassKey = stepId;
  }

  return issues;
}

/**
 * Identifies advisory issues for the selected pipeline configuration.
 *
 * @param state - The current pipeline UI state
 * @returns Advisory pipeline issues
 */
function getAdvisoryIssues(state: UIState): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const { passes } = state;

  if (
    passes.quantization &&
    passes.quantPrecision === "int4" &&
    state.ihvProvider === "CPUExecutionProvider"
  ) {
    issues.push({
      id: "int4-cpu-advisory",
      severity: "warning",
      title: "INT4 on CPU",
      description:
        "INT4 precision is generally not hardware-accelerated on standard CPUs (may fallback to FP32 math).",
      affectedPasses: ["quantization", "provider"],
    });
  }

  // 0.13.0 migration: warn when passRecipeOverrides reference removed/renamed passes.
  const REMOVED_PASSES: Record<string, string> = {
    MobiusModelBuilder: "Renamed to MobiusBuilder in Olive 0.13.0.",
    QairtPreparation: "Removed in Olive 0.13.0 — superseded by QairtPipeline.",
    QairtGenAIBuilder: "Removed in Olive 0.13.0 — superseded by QairtPipeline.",
  };
  if (state.passRecipeOverrides) {
    for (const passName of Object.keys(state.passRecipeOverrides)) {
      if (REMOVED_PASSES[passName]) {
        issues.push({
          id: `removed-pass-${passName}`,
          severity: "warning",
          title: `Deprecated pass: ${passName}`,
          description: REMOVED_PASSES[passName],
          affectedPasses: [passName],
        });
      }
    }
  }

  // 0.13.0: trust_remote_code default flipped. Inform user when it's disabled for HF models.
  if (passes.trustRemoteCode === false && state.modelSource === "huggingface") {
    issues.push({
      id: "trust-remote-code-advisory",
      severity: "info",
      title: "trust_remote_code is disabled",
      description:
        "Some HuggingFace models require trust_remote_code=true. Enable Trust Remote Code in the Hugging Face source settings if model loading fails.",
      affectedTabs: ["input"],
      affectedPasses: ["input_model"],
    });
  }

  return issues;
}

/**
 * Detects recipe task configurations that can fail during Olive or Transformers runtime.
 *
 * @param state - The current UI state used to identify the model source and model path
 * @param recipe - The Olive recipe to inspect
 * @returns Critical issues for invalid task names or Whisper task mismatches
 */
function getRecipeRuntimeIssues(state: UIState, recipe: OliveRecipe): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const input = recipe.input_model as { type?: string; config?: Record<string, unknown> } | undefined;
  const task = typeof input?.config?.task === "string" ? input.config.task : "";
  const modelPath =
    typeof input?.config?.model_path === "string" ? input.config.model_path : state.hfModelId || "";

  if (task === "speech-recognition") {
    issues.push({
      id: "hf-task-speech-recognition-invalid",
      severity: "critical",
      title: "Invalid Hugging Face task",
      description:
        "Recipe uses task `speech-recognition`, which Transformers rejects. Whisper/ASR must use `automatic-speech-recognition` or Olive exits with no output model.",
      affectedTabs: ["input"],
      affectedPasses: ["input_model"],
    });
  }

  if (
    state.modelSource === "huggingface" &&
    /whisper/i.test(modelPath) &&
    task &&
    task !== "automatic-speech-recognition"
  ) {
    issues.push({
      id: "hf-task-whisper-mismatch",
      severity: "critical",
      title: "Whisper task mismatch",
      description: `Whisper model "${modelPath}" has task \`${task}\`. Use \`automatic-speech-recognition\`.`,
      affectedTabs: ["input"],
      affectedPasses: ["input_model"],
    });
  }

  return issues;
}

/**
 * Identifies generated Olive pipeline steps with unknown pass types.
 *
 * @param state - The UI state used to build the Olive recipe
 * @param recipe - Pre-built Olive recipe to avoid redundant builds
 * @returns Critical issues for generated steps whose pass types are missing or unknown
 */
function getPassCatalogIssues(state: UIState, recipe: OliveRecipe): PipelineIssue[] {
  const issues: PipelineIssue[] = [];

  for (const [stepId, passConfig] of Object.entries(recipe.passes ?? {})) {
    const passType = (passConfig as { type?: string }).type;
    if (!passType || isKnownPass(passType)) continue;

    issues.push({
      id: `unknown-pass-type-${stepId}`,
      severity: "critical",
      title: `Unknown Olive pass type: ${passType}`,
      description: `The generated pass type ${passType} for step ${stepId} is not in the Olive MCP pass catalog. This recipe may fail at runtime.`,
      affectedTabs: [stepId],
      affectedPasses: [stepId],
    });
  }

  return issues;
}

/**
 * Identifies issues that prevent local Olive execution with the selected provider.
 *
 * @param state - The current pipeline configuration.
 * @param forLocalExecution - Whether the pipeline is being prepared for local execution.
 * @param probe - Optional hardware probe (needed to clear platform-local gates).
 * @returns Critical issues affecting local execution.
 */
export function getLocalExecutionIssues(
  state: UIState,
  forLocalExecution?: boolean,
  probe?: HardwareProbeResult | null,
): PipelineIssue[] {
  if (!forLocalExecution) {
    return [];
  }

  const provider = state.ihvProvider;
  if (isExportTargetProvider(provider)) {
    const legacyNote = isLegacyExportProvider(provider)
      ? " Prefer QNNExecutionProvider for Snapdragon NPU work."
      : "";
    if (provider === "WebGpuExecutionProvider") {
      return [
        {
          id: "webgpu-local-execution-unsupported",
          severity: "critical",
          title: "WebGPU cannot run via local Olive Python",
          description:
            "WebGpuExecutionProvider is a browser deploy target (ONNX Runtime Web), not a local Python EP. Export the recipe and use Browser Test / WebGPU benchmark instead of Execute Live.",
          affectedPasses: ["provider"],
        },
      ];
    }
    return [
      {
        id: "export-target-local-execution-unsupported",
        severity: "critical",
        title: `${provider} cannot run via local Olive Python`,
        description: `${provider} is an export / deploy target, not a local Python execution provider. Build or export the recipe for the target runtime instead of Execute Live.${legacyNote}`,
        affectedPasses: ["provider"],
      },
    ];
  }

  if (isPlatformLocalProvider(provider)) {
    const detected = Boolean(probe?.detectedProviders.includes(provider));
    // QNN on x64 is "preparation" mode — not a local accelerator, but CAN run Olive
    // for context binary generation. Allow execution only when the runtime is loadable
    // AND the host is a recognized QNN-capable platform (Windows ARM64 or x64).
    const qnnHostMode = probe?.qnn?.hostMode;
    const qnnPreparationAllowed =
      (provider === "QNNExecutionProvider" || provider === "QnnAbiExecutionProvider") &&
      probe?.qnn?.loadable === true &&
      (qnnHostMode === "preparation" || qnnHostMode === "local-inference");
    if (!detected && !qnnPreparationAllowed) {
      return [
        {
          id: "platform-local-execution-unavailable",
          severity: "critical",
          title: `${provider} is not available for local Execute Live`,
          description: `${provider} requires a matching ORT build on this host (and must appear in the hardware probe). You can still select it for recipe export; Execute Live stays blocked until it is detected.`,
          affectedPasses: ["provider"],
        },
      ];
    }
  }

  return [];
}

/**
 * Removes duplicate pipeline issues, retaining the critical issue when duplicate severities differ.
 *
 * @param issues - The pipeline issues to deduplicate
 * @returns The deduplicated pipeline issues
 */
function dedupeIssues(issues: PipelineIssue[]): PipelineIssue[] {
  const byId = new Map<string, PipelineIssue>();
  for (const issue of issues) {
    const existing = byId.get(issue.id);
    if (!existing || (existing.severity === "warning" && issue.severity === "critical")) {
      byId.set(issue.id, issue);
    }
  }
  return Array.from(byId.values());
}

/**
 * Validates the pipeline state and builds its Olive recipe.
 *
 * @param state - The pipeline UI state to validate
 * @param options - Optional hardware and local-execution validation settings
 * @returns Validation issues, status information, and the generated Olive recipe
 */
export function getPipelineValidation(
  state: UIState,
  options?: PipelineValidationOptions,
): PipelineValidationResult {
  // Build the recipe once and pass to functions that need it
  const recipe = buildOliveRecipe(state) as unknown as OliveRecipe;

  const issues = dedupeIssues([
    ...getCrossPassIssues(state),
    ...getProviderIssues(state),
    ...getProviderHardwareIssues(state, options?.hardwareProbe),
    ...getQnnRecipeReadinessIssues(state, recipe, options?.hardwareProbe),
    ...getLocalExecutionIssues(state, options?.forLocalExecution, options?.hardwareProbe),
    ...getAdvisoryIssues(state),
    ...getRecipeRuntimeIssues(state, recipe),
    ...getPassCatalogIssues(state, recipe),
    ...getPassChainIssues(state, recipe),
  ]);

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  // Local heuristics / schema only — not "Olive run succeeded" and not Assistant audit.
  let statusLabel = "Local checks passed";
  let statusTone: PipelineValidationResult["statusTone"] = "success";

  if (criticalCount > 0) {
    statusLabel = `${criticalCount} blocking issue${criticalCount === 1 ? "" : "s"}`;
    statusTone = "error";
  } else if (warningCount > 0) {
    statusLabel = `${warningCount} warning${warningCount === 1 ? "" : "s"}`;
    statusTone = "warning";
  }

  return {
    issues,
    criticalCount,
    warningCount,
    isBlocked: criticalCount > 0,
    statusLabel,
    statusTone,
    recipe,
  };
}

export function applyIssueAutofix(state: UIState, issue: PipelineIssue): Partial<UIState> {
  if (!issue.autofix) return {};
  const next: Partial<UIState> = { ...issue.autofix };
  if (issue.autofix.passes) {
    next.passes = { ...state.passes, ...issue.autofix.passes };
  }
  return next;
}

/** Partial UIState merge patch; nested `passes` keys are shallow-merged at runtime. */
export type UiStatePatch = Partial<Omit<UIState, "passes">> & { passes?: Partial<UIState["passes"]> };

export function mergeUiState(state: UIState, patch: UiStatePatch): UIState {
  // Replace (do not deep-merge) when the key is present so recipe loads can
  // clear stale MCP overrides with `passRecipeOverrides: {}`. Callers that need
  // incremental accumulation (MCP Apply Fix) must merge onto current overrides
  // before setState.
  const passRecipeOverrides =
    patch.passRecipeOverrides !== undefined ? patch.passRecipeOverrides : state.passRecipeOverrides;

  return {
    ...state,
    ...patch,
    passes: patch.passes ? { ...state.passes, ...patch.passes } : state.passes,
    passRecipeOverrides,
  };
}

/** Strip pass/EP combinations that cannot run — applied on every state commit. */
export function coercePassFields(passes: UIState["passes"], provider: IHVProvider): UIState["passes"] {
  const next: UIState["passes"] = { ...passes };

  if (next.conversion && !isConversionFormatAllowed(next.conversionFormat, provider)) {
    next.conversionFormat = "onnx";
  }

  if (next.quantization && !isQuantMethodAllowed(next.quantMethod, provider)) {
    next.quantMethod = "ptq";
  }

  if (next.pruning && next.pruningType === "structured" && !isStructuredPruningAllowed(provider)) {
    next.pruningType = "unstructured";
  }

  if (next.peft && !isPeftAllowed(provider)) {
    next.peft = false;
  }

  if (next.peft && !isPeftMethodAllowed(next.peftMethod, provider)) {
    next.peftMethod = "lora";
  }

  if (next.trustRemoteCode === undefined) {
    next.trustRemoteCode = false;
  }

  if (isReplacementExportPipeline(next)) {
    Object.assign(next, REPLACEMENT_PIPELINE_SUPPRESSED_PASSES);
  }

  // Cross-pass coercions come from the shared CROSS_PASS_RULES table so they
  // cannot drift from the issues getCrossPassIssues surfaces.
  for (const rule of CROSS_PASS_RULES) {
    if (rule.autoCoerce && rule.applies(next, provider)) {
      Object.assign(next, rule.fix);
    }
  }

  return next;
}

export function sanitizePipelineState(state: UIState): UIState {
  const openvinoTargetDevice =
    state.openvinoTargetDevice === "CPU" ||
      state.openvinoTargetDevice === "GPU" ||
      state.openvinoTargetDevice === "NPU"
      ? state.openvinoTargetDevice
      : "CPU";

  let current: UIState = {
    ...state,
    openvinoTargetDevice,
    memoryOffload:
      state.memoryOffload === "auto" && !isMemoryOffloadAvailable(state) ? "gpu_only" : state.memoryOffload,
    passes: coercePassFields(state.passes, state.ihvProvider),
  };

  for (let i = 0; i < 16; i++) {
    const validation = getPipelineValidation(current);
    // Only auto-apply critical fixes; warnings should be surfaced to the user.
    const fixable = validation.issues.filter((issue) => issue.autofix && issue.severity === "critical");
    if (fixable.length === 0) {
      break;
    }

    const issue = fixable[0];

    const patch = applyIssueAutofix(current, issue);
    if (!patch.passes && !patch.ihvProvider && Object.keys(patch).length === 0) {
      break;
    }

    current = mergeUiState(current, patch);
    current = {
      ...current,
      passes: coercePassFields(current.passes, current.ihvProvider),
    };
  }

  return current;
}

const UI_STATE_MODEL_SOURCES = new Set<ModelSource>(["huggingface", "local", "azure"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates an untrusted `state` payload before `buildAiWorkspaceContext`. */
export function parseUIStatePayload(
  value: unknown,
): { ok: true; state: UIState } | { ok: false; error: string } {
  if (!isPlainRecord(value)) {
    return { ok: false, error: "state must be a JSON object" };
  }
  if (
    typeof value.modelSource !== "string" ||
    !UI_STATE_MODEL_SOURCES.has(value.modelSource as ModelSource)
  ) {
    return { ok: false, error: "state.modelSource is invalid" };
  }
  if (typeof value.ihvProvider !== "string" || !value.ihvProvider.endsWith("ExecutionProvider")) {
    return { ok: false, error: "state.ihvProvider is invalid" };
  }
  if (!isPlainRecord(value.passes)) {
    return { ok: false, error: "state.passes must be a JSON object" };
  }
  if (!Array.isArray(value.localFiles)) {
    return { ok: false, error: "state.localFiles must be an array" };
  }
  for (const field of [
    "hfModelId",
    "hfDataset",
    "azureModelPath",
    "cacheDir",
    "azureStr",
    "openvinoTargetDevice",
    "memoryOffload",
    "cudaVersion",
  ] as const) {
    if (typeof value[field] !== "string") {
      return { ok: false, error: `state.${field} must be a string` };
    }
  }
  if (typeof value.distributedCaching !== "boolean") {
    return { ok: false, error: "state.distributedCaching must be a boolean" };
  }
  return { ok: true, state: value as unknown as UIState };
}

export function commitUiStateUpdate(prev: UIState, partial: Partial<UIState>): UIState {
  return sanitizePipelineState(mergeUiState(prev, partial));
}

export function getAllowedQuantMethods(provider: IHVProvider): UIState["passes"]["quantMethod"][] {
  const methods: UIState["passes"]["quantMethod"][] = [
    "ptq",
    "awq",
    "gptq",
    "qat",
    "hqq",
    "rtn",
    "kquant",
    "spinquant",
    "quarot",
  ];
  return methods.filter((method) => isQuantMethodAllowed(method, provider));
}

export function getAllowedConversionFormats(provider: IHVProvider): UIState["passes"]["conversionFormat"][] {
  const formats: UIState["passes"]["conversionFormat"][] = ["onnx", "openvino"];
  return formats.filter((format) => isConversionFormatAllowed(format, provider));
}

export function getAllowedPeftMethods(provider: IHVProvider): UIState["passes"]["peftMethod"][] {
  const methods: UIState["passes"]["peftMethod"][] = ["lora", "qlora"];
  return methods.filter((method) => isPeftMethodAllowed(method, provider));
}

export function getAllowedPruningTypes(provider: IHVProvider): UIState["passes"]["pruningType"][] {
  const types: UIState["passes"]["pruningType"][] = ["unstructured", "structured"];
  return types.filter((type) => type === "unstructured" || isStructuredPruningAllowed(provider));
}

/** Issues that remain after sanitization (informational only). */
export function getRemainingAdvisories(state: UIState): PipelineIssue[] {
  return getPipelineValidation(state).issues.filter(
    (issue) => issue.severity === "warning" && !issue.autofix,
  );
}
