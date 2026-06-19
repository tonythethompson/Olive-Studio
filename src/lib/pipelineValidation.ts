import { IHVProvider, UIState } from "@/types";

export type IssueSeverity = "critical" | "warning" | "info";

export interface PipelineIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  affectedTabs?: string[];
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
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
];
const TENSOR_CORE_PROVIDERS: IHVProvider[] = ["CUDAExecutionProvider", "TensorrtExecutionProvider"];

export function isQuantMethodAllowed(
  method: UIState["passes"]["quantMethod"],
  provider: IHVProvider
): boolean {
  if (method === "awq") {
    return GPU_PROVIDERS.includes(provider);
  }
  if (method === "qat") {
    return provider !== "QNNExecutionProvider";
  }
  return true;
}

export function isConversionFormatAllowed(
  format: UIState["passes"]["conversionFormat"],
  provider: IHVProvider
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
  return !["QNNExecutionProvider", "OpenVINOExecutionProvider"].includes(provider);
}

export function isPeftMethodAllowed(
  method: UIState["passes"]["peftMethod"],
  provider: IHVProvider
): boolean {
  if (method === "qlora") {
    return GPU_PROVIDERS.includes(provider);
  }
  return true;
}

export function getProviderConflicts(
  providerId: IHVProvider,
  passes: UIState["passes"]
): HardwareConflict[] {
  const conflicts: HardwareConflict[] = [];

  const add = (active: boolean, conflict: HardwareConflict) => {
    if (active) conflicts.push(conflict);
  };

  add(passes.conversion && passes.conversionFormat === "openvino" && !isConversionFormatAllowed("openvino", providerId), {
    passKey: "conversionFormat",
    passName: "OpenVINO IR Conversion",
    reason: "OpenVINO IR requires the Intel OpenVINO execution provider.",
    severity: "critical",
    autofix: () => ({ conversionFormat: "onnx" }),
  });

  add(passes.quantization && passes.quantMethod === "awq" && !isQuantMethodAllowed("awq", providerId), {
    passKey: "quantMethod",
    passName: "AWQ Quantization",
    reason: "AWQ requires NVIDIA CUDA, TensorRT, or AMD ROCm GPU acceleration.",
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

  add(
    passes.pruning && passes.pruningType === "structured" && !isStructuredPruningAllowed(providerId),
    {
      passKey: "pruningType",
      passName: "Structured 2:4 Sparsity",
      reason: "Structured sparsity requires NVIDIA CUDA or TensorRT tensor-core hardware.",
      severity: "warning",
      autofix: () => ({ pruningType: "unstructured" }),
    }
  );

  add(passes.peft && !isPeftAllowed(providerId), {
    passKey: "peft",
    passName: "PEFT / LoRA Training",
    reason:
      providerId === "QNNExecutionProvider"
        ? "Snapdragon QNN targets are inference-only and cannot run PEFT training loops."
        : "Intel OpenVINO targets are inference-only; PEFT training requires CUDA or ROCm.",
    severity: providerId === "QNNExecutionProvider" ? "critical" : "warning",
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

export function isProviderCompatibleWithPasses(
  providerId: IHVProvider,
  passes: UIState["passes"]
): boolean {
  return getProviderConflicts(providerId, passes).every((c) => c.severity !== "critical");
}

export function hasProviderCriticalConflicts(
  providerId: IHVProvider,
  passes: UIState["passes"]
): boolean {
  return getProviderConflicts(providerId, passes).some((c) => c.severity === "critical");
}

function getCrossPassIssues(state: UIState): PipelineIssue[] {
  const { passes } = state;
  const issues: PipelineIssue[] = [];

  if (passes.pruning && passes.quantization && passes.quantMethod === "awq") {
    issues.push({
      id: "pruning-awq",
      severity: "critical",
      title: "Pruning & AWQ Quantization Conflict",
      description:
        "Pruning destroys the tensor structures and activates scale gradients that AWQ depends on. This causes weight distribution scale mismatch.",
      affectedTabs: ["quantization", "compression"],
      actionLabel: "Switch Quantization to PTQ",
      autofix: { passes: { ...passes, quantMethod: "ptq" } },
    });
  }

  if (passes.peft && passes.quantization && passes.quantPrecision !== "fp16" && passes.peftMethod === "lora") {
    issues.push({
      id: "peft-lora-quant",
      severity: "critical",
      title: "LoRA Adapters active with base Quantization",
      description:
        "Standard LoRA expects floating-point base parameters to optimize. If you use integers (INT4/INT8), you must select QLoRA's double-quantized parameters.",
      affectedTabs: ["quantization", "peft"],
      actionLabel: "Enable QLoRA Mode",
      autofix: { passes: { ...passes, peftMethod: "qlora" } },
    });
  }

  if (passes.pruning && passes.quantization && passes.quantPrecision === "int4") {
    issues.push({
      id: "pruning-int4-collapse",
      severity: "warning",
      title: "INT4 & Sparsity Double Compress",
      description:
        "Applying both sparsity pruning and aggressive INT4 quantization leads to extreme mathematical precision decline and accuracy degradation.",
      affectedTabs: ["quantization", "compression"],
      actionLabel: "Increase Quant to INT8",
      autofix: { passes: { ...passes, quantPrecision: "int8" } },
    });
  }

  if (passes.conversion && passes.conversionFormat === "openvino" && passes.onnxTransforms) {
    issues.push({
      id: "openvino-onnx-transforms-clash",
      severity: "warning",
      title: "Redundant Transforms with OpenVINO IR",
      description:
        "Manual ONNX graph layout transforms are redundant and can clash during subsequent compilation into OpenVINO XML representation.",
      affectedTabs: ["conversion", "transforms"],
      actionLabel: "Deactivate ONNX Transforms",
      autofix: { passes: { ...passes, onnxTransforms: false } },
    });
  }

  if (passes.splitting && passes.quantization && passes.quantMethod === "qat") {
    issues.push({
      id: "splitting-qat-conflict",
      severity: "critical",
      title: "Splitting + QAT Incompatibility",
      description:
        "Model splitting breaks the weights dictionary across boundary subroutines. QAT fine-tuning requires unbroken parameters.",
      affectedTabs: ["conversion", "quantization"],
      actionLabel: "Disable Model Splitting",
      autofix: { passes: { ...passes, splitting: false } },
    });
  }

  if (passes.peft && passes.peftMethod === "qlora" && state.ihvProvider === "CPUExecutionProvider") {
    issues.push({
      id: "cpu-qlora-mismatch",
      severity: "warning",
      title: "Inefficient PEFT Stage: QLoRA on CPU",
      description:
        "QLoRA gradients expect specialized GPU CUDA kernels. Training adapters on standard CPU threads is highly inefficient and slow.",
      affectedTabs: ["peft"],
      actionLabel: "Revert PEFT to floating-point LoRA",
      autofix: { passes: { ...passes, peftMethod: "lora" } },
    });
  }

  if (
    passes.conversion &&
    passes.conversionFormat === "openvino" &&
    state.ihvProvider !== "OpenVINOExecutionProvider"
  ) {
    issues.push({
      id: "openvino-ep-mismatch",
      severity: "critical",
      title: "OpenVINO IR with incompatible execution provider",
      description:
        "OpenVINO conversion format is selected, but the target hardware is not Intel OpenVINO. Pipeline execution will fail.",
      affectedTabs: ["conversion"],
      actionLabel: "Switch conversion to ONNX",
      autofix: { passes: { ...passes, conversionFormat: "onnx" } },
    });
  }

  return issues;
}

function getProviderIssues(state: UIState): PipelineIssue[] {
  return getProviderConflicts(state.ihvProvider, state.passes).map((c) => ({
    id: `provider-${state.ihvProvider}-${c.passKey}`,
    severity: c.severity,
    title: `${c.passName} incompatible with ${state.ihvProvider.replace("ExecutionProvider", "")}`,
    description: c.reason,
    actionLabel: "Apply suggested fix",
    autofix: { passes: { ...state.passes, ...c.autofix() } },
  }));
}

function getAdvisoryIssues(state: UIState): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const { passes } = state;

  if (passes.quantization && passes.quantPrecision === "int4" && state.ihvProvider === "CPUExecutionProvider") {
    issues.push({
      id: "int4-cpu-advisory",
      severity: "warning",
      title: "INT4 on CPU",
      description:
        "INT4 precision is generally not hardware-accelerated on standard CPUs (may fallback to FP32 math).",
    });
  }

  return issues;
}

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

export function getPipelineValidation(state: UIState): PipelineValidationResult {
  const issues = dedupeIssues([
    ...getCrossPassIssues(state),
    ...getProviderIssues(state),
    ...getAdvisoryIssues(state),
  ]);

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  let statusLabel = "Recipe validated";
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

export function mergeUiState(state: UIState, patch: Partial<UIState>): UIState {
  return {
    ...state,
    ...patch,
    passes: patch.passes ? { ...state.passes, ...patch.passes } : state.passes,
  };
}

/** Strip pass/EP combinations that cannot run — applied on every state commit. */
export function coercePassFields(passes: UIState["passes"], provider: IHVProvider): UIState["passes"] {
  let next: UIState["passes"] = { ...passes };

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

  if (next.pruning && next.quantization && next.quantMethod === "awq") {
    next.quantMethod = "ptq";
  }

  if (next.peft && next.quantization && next.quantPrecision !== "fp16" && next.peftMethod === "lora") {
    next.peftMethod = "qlora";
  }

  if (next.splitting && next.quantization && next.quantMethod === "qat") {
    next.splitting = false;
  }

  if (next.conversion && next.conversionFormat === "openvino" && next.onnxTransforms) {
    next.onnxTransforms = false;
  }

  if (next.pruning && next.quantization && next.quantPrecision === "int4") {
    next.quantPrecision = "int8";
  }

  return next;
}

export function sanitizePipelineState(state: UIState): UIState {
  let current: UIState = {
    ...state,
    passes: coercePassFields(state.passes, state.ihvProvider),
  };

  for (let i = 0; i < 16; i++) {
    const validation = getPipelineValidation(current);
    const fixable = validation.issues.filter((issue) => issue.autofix);
    if (fixable.length === 0) {
      break;
    }

    const issue =
      fixable.find((candidate) => candidate.severity === "critical") ??
      fixable[0];

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

export function commitUiStateUpdate(prev: UIState, partial: Partial<UIState>): UIState {
  return sanitizePipelineState(mergeUiState(prev, partial));
}

export function getAllowedQuantMethods(provider: IHVProvider): UIState["passes"]["quantMethod"][] {
  const methods: UIState["passes"]["quantMethod"][] = ["ptq", "awq", "qat"];
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
  return types.filter(
    (type) => type === "unstructured" || isStructuredPruningAllowed(provider)
  );
}

/** Issues that remain after sanitization (informational only). */
export function getRemainingAdvisories(state: UIState): PipelineIssue[] {
  return getPipelineValidation(state).issues.filter(
    (issue) => issue.severity === "warning" && !issue.autofix
  );
}
