import { UIState } from "@/types";
import { getPipelineValidation, getProviderConflicts } from "@/lib/pipelineValidation";
import { buildOliveRecipe, resolveHfTask } from "@/lib/oliveRecipeBuilder";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

export interface AiWorkspaceProbeSummary {
  recommendedProvider: string;
  detectedProviders: string[];
  gpus: Array<{ name: string; vramMb?: number }>;
  cudaVersion?: string;
  cudaTag?: string;
  systemRamGb?: number;
  onnxRuntimeProviders?: string[];
  notes: string[];
}

export interface AiWorkspaceRecipeSnapshot {
  inputModelType: string;
  passTypes: string[];
  accelerator: unknown;
  /** Clipped JSON of the current built Olive recipe for the model. */
  jsonPreview: string;
}

export interface AiWorkspaceContext {
  modelSource: UIState["modelSource"];
  model: {
    huggingFaceId: string;
    huggingFaceDataset: string;
    /** Resolved Olive/HF task written into recipes (explicit or inferred). */
    hfTask: string;
    /** True when hfTask came from inference, not an explicit UI override. */
    hfTaskInferred: boolean;
    localFileNames: string[];
    azurePath: string;
    displayName: string;
  };
  hardware: {
    executionProvider: UIState["ihvProvider"];
    executionProviderShort: string;
    cudaVersion: UIState["cudaVersion"];
    memoryOffload: UIState["memoryOffload"];
  };
  /** Live hardware probe when available (GPU/VRAM/detected EPs). */
  detectedHardware?: AiWorkspaceProbeSummary;
  /** Snapshot of the Olive recipe the UI would emit right now. */
  recipeSnapshot?: AiWorkspaceRecipeSnapshot;
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
    activeJobId?: string | null;
    recentLogTail?: string[];
  };
}

export type BuildAiWorkspaceContextOptions = {
  probe?: HardwareProbeResult | null;
  /** Max chars of recipe JSON in the prompt (default 3500). */
  recipePreviewChars?: number;
};

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
    const preset = passes.quantPreset ? `, preset: ${passes.quantPreset}` : "";
    const extra =
      passes.quantMethod === "gptq"
        ? ` block=${passes.gptqBlockSize} group=${passes.gptqGroupSize} desc_act=${passes.gptqDescAct}`
        : passes.quantMethod === "awq"
          ? ` group=${passes.awqGroupSize} damp=${passes.awqDampPercent} sym=${passes.awqSym}`
          : passes.quantMethod === "qat"
            ? ` precision=${passes.qatQuantPrecision} method=${passes.qatCalibrateMethod} steps=${passes.qatCalibrateSteps}`
            : "";
    labels.push(`quantization (${passes.quantMethod} ${passes.quantPrecision}${preset}${extra})`);
  }
  if (passes.pruning) {
    labels.push(
      `pruning (${passes.pruningMethod}, ${Math.round(passes.pruningSparsity * 100)}% ${passes.pruningType})`,
    );
  }
  if (passes.onnxTransforms) labels.push("onnx transforms");
  if (passes.splitting) labels.push("graph splitting");
  if (passes.peft) labels.push(`peft (${passes.peftMethod})`);
  if (passes.diffusionLora) labels.push("diffusion lora");
  return labels;
}

function summarizeProbe(probe: HardwareProbeResult): AiWorkspaceProbeSummary {
  const gpus = [
    ...(probe.nvidia?.gpus ?? []).map((g) => ({ name: g.name, vramMb: g.vramMb })),
    ...(probe.rocm?.gpus ?? []).map((g) => ({ name: g.name, vramMb: g.vramMb })),
  ].slice(0, 4);
  return {
    recommendedProvider: probe.recommendedProvider,
    detectedProviders: probe.detectedProviders,
    gpus,
    cudaVersion: probe.nvidia?.cudaVersion,
    cudaTag: probe.nvidia?.cudaTag,
    systemRamGb: probe.platform.systemRamGb,
    onnxRuntimeProviders: probe.onnxRuntimeProviders?.slice(0, 12),
    notes: probe.notes.slice(0, 6),
  };
}

function buildRecipeSnapshot(state: UIState, maxChars: number): AiWorkspaceRecipeSnapshot | undefined {
  try {
    const recipe = buildOliveRecipe(state);
    const input = recipe.input_model as { type?: string } | undefined;
    const passes = (recipe.passes ?? {}) as Record<string, { type?: string }>;
    const passTypes = Object.values(passes)
      .map((p) => p?.type)
      .filter((t): t is string => typeof t === "string");
    const systems = recipe.systems as { local_system?: { config?: { accelerators?: unknown } } } | undefined;
    const json = JSON.stringify(recipe, null, 2);
    return {
      inputModelType: input?.type ?? "unknown",
      passTypes,
      accelerator: systems?.local_system?.config?.accelerators ?? null,
      jsonPreview: json.length > maxChars ? `${json.slice(0, maxChars)}\n…(recipe truncated)` : json,
    };
  } catch {
    return undefined;
  }
}

function recentLogTail(state: UIState): string[] | undefined {
  const jobs = state.batchJobs ?? [];
  const active =
    (state.activeJobId &&
      jobs.find((j) => j.oliveJobId === state.activeJobId || j.id === state.activeJobId)) ||
    jobs.find((j) => j.status === "failed") ||
    jobs.find((j) => j.status === "running") ||
    jobs[jobs.length - 1];
  if (!active?.logs?.length) return undefined;
  return active.logs.slice(-25);
}

export function buildAiWorkspaceContext(
  state: UIState,
  opts?: BuildAiWorkspaceContextOptions,
): AiWorkspaceContext {
  const validation = getPipelineValidation(state);
  const conflicts = getProviderConflicts(state.ihvProvider, state.passes);
  const batchJobs = state.batchJobs ?? [];
  const displayName = resolveModelDisplayName(state);
  const recipePreviewChars = opts?.recipePreviewChars ?? 3500;
  const logTail = recentLogTail(state);
  const explicitTask = state.hfTask?.trim() ?? "";
  const hfTask = resolveHfTask(state);

  return {
    modelSource: state.modelSource,
    model: {
      huggingFaceId: state.hfModelId,
      huggingFaceDataset: state.hfDataset,
      hfTask,
      hfTaskInferred: !explicitTask,
      localFileNames: state.localFiles.map((f) => f.name),
      azurePath: state.azureModelPath,
      displayName,
    },
    hardware: {
      executionProvider: state.ihvProvider,
      executionProviderShort: shortProvider(state.ihvProvider),
      cudaVersion: state.cudaVersion,
      memoryOffload: state.memoryOffload,
    },
    detectedHardware: opts?.probe ? summarizeProbe(opts.probe) : undefined,
    recipeSnapshot: buildRecipeSnapshot(state, recipePreviewChars),
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
      activeJobId: state.activeJobId ?? null,
      recentLogTail: logTail,
    },
  };
}

export function formatAiWorkspaceContextForPrompt(ctx: AiWorkspaceContext): string {
  const lines = [
    "Current Olive Studio workspace (live UI selections):",
    `- Model source: ${ctx.modelSource}`,
    `- Model: ${ctx.model.displayName}`,
    `- HF / Olive task: ${ctx.model.hfTask}${ctx.model.hfTaskInferred ? " (inferred from model id)" : " (set in UI)"}`,
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
    `- Selected execution provider: ${ctx.hardware.executionProvider} (CUDA tag: ${ctx.hardware.cudaVersion}, memory offload: ${ctx.hardware.memoryOffload})`,
  );

  if (ctx.detectedHardware) {
    const hw = ctx.detectedHardware;
    lines.push(
      `- Detected hardware: recommended=${hw.recommendedProvider}; providers=${hw.detectedProviders.join(", ") || "CPU"}`,
    );
    if (hw.gpus.length > 0) {
      lines.push(
        `- GPUs: ${hw.gpus.map((g) => `${g.name}${g.vramMb ? ` (${Math.round(g.vramMb / 1024)} GB)` : ""}`).join("; ")}`,
      );
    }
    if (hw.cudaVersion || hw.cudaTag) {
      lines.push(`- Host CUDA: ${hw.cudaVersion ?? "unknown"}${hw.cudaTag ? ` (tag ${hw.cudaTag})` : ""}`);
    }
    if (hw.systemRamGb != null) {
      lines.push(`- System RAM: ${hw.systemRamGb} GB`);
    }
    if (hw.onnxRuntimeProviders?.length) {
      lines.push(`- ORT providers in venv: ${hw.onnxRuntimeProviders.join(", ")}`);
    }
    if (hw.notes.length > 0) {
      lines.push("- Probe notes:");
      for (const note of hw.notes.slice(0, 4)) {
        lines.push(`  • ${note}`);
      }
    }
  }

  lines.push(
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

  if (ctx.passes.quantization) {
    const preset = ctx.passes.quantPreset || "(custom/manual)";
    lines.push(`- Quantization preset: ${preset}`);
    lines.push(`- Quant method: ${ctx.passes.quantMethod}`);
    if (ctx.passes.quantMethod === "gptq") {
      lines.push(
        `  ├ block_size=${ctx.passes.gptqBlockSize}  group_size=${ctx.passes.gptqGroupSize}  desc_act=${ctx.passes.gptqDescAct}`,
      );
    } else if (ctx.passes.quantMethod === "awq") {
      lines.push(
        `  ├ group_size=${ctx.passes.awqGroupSize}  damp_percent=${ctx.passes.awqDampPercent}  sym=${ctx.passes.awqSym}`,
      );
    } else if (ctx.passes.quantMethod === "qat") {
      lines.push(
        `  ├ quant_precision=${ctx.passes.qatQuantPrecision}  calibrate_method=${ctx.passes.qatCalibrateMethod}  calibrate_steps=${ctx.passes.qatCalibrateSteps}`,
      );
    }
  }

  if (ctx.recipeSnapshot) {
    lines.push(
      `- Built recipe: input=${ctx.recipeSnapshot.inputModelType}; passes=${ctx.recipeSnapshot.passTypes.join(", ") || "none"}`,
    );
    lines.push("- Recipe JSON snapshot:");
    lines.push("```json");
    lines.push(ctx.recipeSnapshot.jsonPreview);
    lines.push("```");
  }

  if (ctx.infrastructure.batchJobCount > 0) {
    lines.push(
      `- Batch queue: ${ctx.infrastructure.batchJobCount} total (${ctx.infrastructure.batchQueued} queued, ${ctx.infrastructure.batchRunning} running)`,
    );
  }

  if (ctx.infrastructure.activeJobId) {
    lines.push(`- Active job id: ${ctx.infrastructure.activeJobId}`);
  }

  if (ctx.infrastructure.recentLogTail?.length) {
    lines.push("- Recent job log tail:");
    for (const line of ctx.infrastructure.recentLogTail) {
      lines.push(`  ${line}`);
    }
  }

  if (ctx.infrastructure.cacheDir) {
    lines.push(`- Cache dir: ${ctx.infrastructure.cacheDir}`);
  }

  lines.push(
    "",
    "Answer using these selections as ground truth. If the user asks about their setup, reference the values above explicitly.",
    "When you recommend a concrete UI change, include an Apply action patch the user can click.",
  );

  return lines.join("\n");
}

export function buildWorkspaceContextSummary(ctx: AiWorkspaceContext): string {
  const model = shortModelName(ctx.model.displayName);
  const passes =
    ctx.activePassLabels.length > 0 ? ctx.activePassLabels.slice(0, 2).join(" · ") : "no passes enabled";
  const val =
    ctx.validation.criticalCount > 0
      ? `${ctx.validation.criticalCount} blocking`
      : ctx.validation.warningCount > 0
        ? `${ctx.validation.warningCount} warnings`
        : "valid";
  const gpu = ctx.detectedHardware?.gpus[0]?.name
    ? ` · ${shortModelName(ctx.detectedHardware.gpus[0].name)}`
    : "";
  return `${model} · ${ctx.hardware.executionProviderShort}${gpu} · ${passes} · ${val}`;
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
      `${ctx.passes.pruningMethod} pruning at ${Math.round(ctx.passes.pruningSparsity * 100)}%: accuracy vs latency?`,
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

  if (
    ctx.passes.quantization &&
    ctx.passes.quantMethod === "awq" &&
    !GPU_PROVIDERS.has(ctx.hardware.executionProvider)
  ) {
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
