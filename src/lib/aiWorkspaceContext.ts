import { UIState } from "@/types";
import { getPipelineValidation, getProviderConflicts } from "@/lib/pipelineValidation";

export interface AiWorkspaceContext {
  modelSource: UIState["modelSource"];
  model: {
    huggingFaceId: string;
    huggingFaceDataset: string;
    localFileNames: string[];
    azurePath: string;
    displayName: string;
  };
  hardware: {
    executionProvider: UIState["ihvProvider"];
    executionProviderShort: string;
    cudaVersion: UIState["cudaVersion"];
  };
  passes: UIState["passes"];
  activePassLabels: string[];
  validation: {
    statusLabel: string;
    isBlocked: boolean;
    criticalCount: number;
    warningCount: number;
    topIssues: Array<{ severity: string; title: string; description: string }>;
  };
  providerConflicts: Array<{ passName: string; reason: string; severity: string }>;
  infrastructure: {
    cacheDir: string;
    distributedCaching: boolean;
    batchJobCount: number;
    batchQueued: number;
    batchRunning: number;
  };
}

function shortProvider(provider: UIState["ihvProvider"]): string {
  return provider.replace("ExecutionProvider", "");
}

function resolveModelDisplayName(state: UIState): string {
  if (state.modelSource === "huggingface" && state.hfModelId.trim()) {
    return state.hfModelId.trim();
  }
  if (state.modelSource === "local" && state.localFiles.length > 0) {
    return state.localFiles.map((f) => f.name).join(", ");
  }
  if (state.modelSource === "azure" && state.azureModelPath.trim()) {
    return state.azureModelPath.trim();
  }
  if (state.hfModelId.trim()) return state.hfModelId.trim();
  return "(not set)";
}

function shortModelName(displayName: string): string {
  if (displayName === "(not set)") return displayName;
  const first = displayName.split(",")[0]?.trim() ?? displayName;
  const slash = first.lastIndexOf("/");
  if (slash >= 0) return first.slice(slash + 1);
  return first.length > 36 ? `${first.slice(0, 33)}…` : first;
}

function collectActivePassLabels(passes: UIState["passes"]): string[] {
  const labels: string[] = [];
  if (passes.conversion) {
    labels.push(`conversion (${passes.conversionFormat}, opset ${passes.conversionOpset})`);
  }
  if (passes.quantization) {
    labels.push(`quantization (${passes.quantMethod} ${passes.quantPrecision})`);
  }
  if (passes.pruning) {
    labels.push(`pruning (${passes.pruningMethod}, ${Math.round(passes.pruningSparsity * 100)}% ${passes.pruningType})`);
  }
  if (passes.onnxTransforms) labels.push("onnx transforms");
  if (passes.splitting) labels.push("graph splitting");
  if (passes.peft) labels.push(`peft (${passes.peftMethod})`);
  if (passes.diffusionLora) labels.push("diffusion lora");
  return labels;
}

export function buildAiWorkspaceContext(state: UIState): AiWorkspaceContext {
  const validation = getPipelineValidation(state);
  const conflicts = getProviderConflicts(state.ihvProvider, state.passes);
  const batchJobs = state.batchJobs ?? [];
  const displayName = resolveModelDisplayName(state);

  return {
    modelSource: state.modelSource,
    model: {
      huggingFaceId: state.hfModelId,
      huggingFaceDataset: state.hfDataset,
      localFileNames: state.localFiles.map((f) => f.name),
      azurePath: state.azureModelPath,
      displayName,
    },
    hardware: {
      executionProvider: state.ihvProvider,
      executionProviderShort: shortProvider(state.ihvProvider),
      cudaVersion: state.cudaVersion,
    },
    passes: state.passes,
    activePassLabels: collectActivePassLabels(state.passes),
    validation: {
      statusLabel: validation.statusLabel,
      isBlocked: validation.isBlocked,
      criticalCount: validation.criticalCount,
      warningCount: validation.warningCount,
      topIssues: validation.issues.slice(0, 5).map((i) => ({
        severity: i.severity,
        title: i.title,
        description: i.description,
      })),
    },
    providerConflicts: conflicts.map((c) => ({
      passName: c.passName,
      reason: c.reason,
      severity: c.severity,
    })),
    infrastructure: {
      cacheDir: state.cacheDir,
      distributedCaching: state.distributedCaching,
      batchJobCount: batchJobs.length,
      batchQueued: batchJobs.filter((j) => j.status === "queued").length,
      batchRunning: batchJobs.filter((j) => j.status === "running").length,
    },
  };
}

export function formatAiWorkspaceContextForPrompt(ctx: AiWorkspaceContext): string {
  const lines = [
    "Current Olive Studio workspace (live UI selections):",
    `- Model source: ${ctx.modelSource}`,
    `- Model: ${ctx.model.displayName}`,
  ];

  if (ctx.model.huggingFaceDataset) {
    lines.push(`- Calibration dataset: ${ctx.model.huggingFaceDataset}`);
  }
  if (ctx.model.localFileNames.length > 0) {
    lines.push(`- Local files: ${ctx.model.localFileNames.join(", ")}`);
  }
  if (ctx.model.azurePath) {
    lines.push(`- Azure path: ${ctx.model.azurePath}`);
  }

  lines.push(
    `- Execution provider: ${ctx.hardware.executionProvider} (CUDA tag: ${ctx.hardware.cudaVersion})`,
    `- Active passes: ${ctx.activePassLabels.length ? ctx.activePassLabels.join("; ") : "none"}`,
    `- Pipeline validation: ${ctx.validation.statusLabel} (${ctx.validation.criticalCount} critical, ${ctx.validation.warningCount} warnings)`,
  );

  if (ctx.validation.topIssues.length > 0) {
    lines.push("- Validation notes:");
    for (const issue of ctx.validation.topIssues) {
      lines.push(`  • [${issue.severity}] ${issue.title}: ${issue.description}`);
    }
  }

  if (ctx.providerConflicts.length > 0) {
    lines.push("- IHV pass conflicts on selected provider:");
    for (const c of ctx.providerConflicts) {
      lines.push(`  • [${c.severity}] ${c.passName}: ${c.reason}`);
    }
  }

  if (ctx.infrastructure.batchJobCount > 0) {
    lines.push(
      `- Batch queue: ${ctx.infrastructure.batchJobCount} total (${ctx.infrastructure.batchQueued} queued, ${ctx.infrastructure.batchRunning} running)`,
    );
  }

  if (ctx.infrastructure.cacheDir) {
    lines.push(`- Cache dir: ${ctx.infrastructure.cacheDir}`);
  }

  lines.push(
    "",
    "Answer using these selections as ground truth. If the user asks about their setup, reference the values above explicitly.",
  );

  return lines.join("\n");
}

export function buildWorkspaceContextSummary(ctx: AiWorkspaceContext): string {
  const model = shortModelName(ctx.model.displayName);
  const passes =
    ctx.activePassLabels.length > 0
      ? ctx.activePassLabels.slice(0, 2).join(" · ")
      : "no passes enabled";
  const val =
    ctx.validation.criticalCount > 0
      ? `${ctx.validation.criticalCount} blocking`
      : ctx.validation.warningCount > 0
        ? `${ctx.validation.warningCount} warnings`
        : "valid";
  return `${model} · ${ctx.hardware.executionProviderShort} · ${passes} · ${val}`;
}

export function buildChatPresetQueries(state: UIState): string[] {
  const ctx = buildAiWorkspaceContext(state);
  const queries: string[] = [];
  const ep = ctx.hardware.executionProviderShort;
  const model = shortModelName(ctx.model.displayName);

  if (ctx.validation.criticalCount > 0 && ctx.validation.topIssues[0]) {
    queries.push(`How do I fix: ${ctx.validation.topIssues[0].title}?`);
  }

  if (ctx.providerConflicts.length > 0) {
    const c = ctx.providerConflicts[0];
    queries.push(`Resolve ${c.passName} conflict on ${ep}`);
  }

  if (ctx.passes.quantization) {
    queries.push(
      `Is ${ctx.passes.quantMethod.toUpperCase()} ${ctx.passes.quantPrecision} right for ${model} on ${ep}?`,
    );
  } else if (ctx.model.displayName !== "(not set)") {
    queries.push(`What quantization should I use for ${model} on ${ep}?`);
  }

  if (ctx.passes.conversion) {
    queries.push(
      `Review ${ctx.passes.conversionFormat.toUpperCase()} conversion (opset ${ctx.passes.conversionOpset}) for ${ep}`,
    );
  }

  if (ctx.passes.pruning) {
    queries.push(
      `${ctx.passes.pruningMethod} pruning at ${Math.round(ctx.passes.pruningSparsity * 100)}% — accuracy vs latency?`,
    );
  }

  if (ctx.passes.peft) {
    queries.push(`Best pass order for ${ctx.passes.peftMethod.toUpperCase()} on ${ep}?`);
  }

  if (ctx.modelSource === "local" && ctx.model.localFileNames.length > 0) {
    queries.push(`Local model workflow for ${shortModelName(ctx.model.localFileNames[0]!)} on ${ep}`);
  }

  if (ctx.infrastructure.batchQueued > 0) {
    queries.push(`Optimize run order for ${ctx.infrastructure.batchQueued} queued batch jobs`);
  } else if (ctx.infrastructure.batchRunning > 0) {
    queries.push("What should I watch for in the running batch job logs?");
  }

  if (ctx.passes.quantization && ctx.passes.quantMethod === "awq" && !GPU_PROVIDERS.has(ctx.hardware.executionProvider)) {
    queries.push(`Why is AWQ a poor fit for ${ep}?`);
  }

  const fallbacks = [
    `Recommend a pass sequence for max throughput on ${ep}`,
    "Which Olive passes usually run before quantization?",
    `Trade-offs of ${ctx.hardware.executionProvider} vs CPU for this recipe`,
  ];

  for (const fb of fallbacks) {
    if (queries.length >= 4) break;
    if (!queries.includes(fb)) queries.push(fb);
  }

  return queries.slice(0, 4);
}

const GPU_PROVIDERS = new Set([
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
]);
