import { type UIState, type BatchJob } from "@/types";
import { buildRecipeJsonFromState } from "@/lib/recipePipeline";

/**
 * Returns the display names of active passes in the given state, falling back
 * to a default baseline export label when no pass is enabled.
 */
export function collectActivePassNames(passes: UIState["passes"]): string[] {
  const names: string[] = [];
  if (passes.conversion) {
    names.push(`Conversion (${passes.conversionFormat === "onnx" ? "ONNX" : "OpenVINO"})`);
  }
  if (passes.quantization) names.push(`Quantization (${passes.quantPrecision})`);
  if (passes.pruning) names.push(`Pruning (${passes.pruningMethod})`);
  if (passes.onnxTransforms) names.push("ORT Transforms");
  return names.length > 0 ? names : ["Default Baseline Export"];
}

/** Resolves a human-readable model identifier for the active model source. */
export function resolveQueuedModelIdentifier(state: UIState): string {
  if (state.modelSource === "huggingface") return state.hfModelId || "unspecified-hf-model";
  if (state.modelSource === "azure") return state.azureModelPath || "AzureML Asset Container";
  return "Offline Weights Folder";
}

/** Builds a queued batch job snapshot from the current pipeline state. */
export function buildQueuedBatchJob(state: UIState): BatchJob {
  const mid = resolveQueuedModelIdentifier(state);
  const activePassesNames = collectActivePassNames(state.passes);
  const jobName = `Staged: ${mid.split("/").pop()} - ${state.ihvProvider.replace("ExecutionProvider", "")}`;
  return {
    id: "job-" + Date.now(),
    name: jobName,
    modelSource: state.modelSource,
    modelIdentifier: mid,
    provider: state.ihvProvider,
    passes: activePassesNames,
    recipeJson: buildRecipeJsonFromState(state),
    status: "queued",
    progress: 0,
    progressKnown: true,
    logs: ["Job created from active template configuration. Awaiting queue start."],
  };
}

/**
 * Summarizes MCP-applied UI patches and quirks into log-friendly strings so
 * users can see exactly what the "Apply Fix" flow changed.
 */
export function describeAppliedMcpPatches(
  patches: { cacheDir?: string; passRecipeOverrides?: Record<string, unknown>; passes?: Partial<UIState["passes"]> },
  statePasses: UIState["passes"],
  appliedQuirks: string[],
): string[] {
  const appliedParts: string[] = [];
  if (patches.cacheDir) appliedParts.push(`cacheDir=${patches.cacheDir}`);
  if (patches.passRecipeOverrides) {
    appliedParts.push(`passOverrides=${Object.keys(patches.passRecipeOverrides).join("+")}`);
  }
  if (patches.passes) {
    const changed = Object.entries(patches.passes)
      .filter(([k, v]) => (statePasses as Record<string, unknown>)[k] !== v)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    if (changed.length) appliedParts.push(...changed.slice(0, 8));
  }
  if (appliedQuirks.length) appliedParts.push(`quirks=${appliedQuirks.join("+")}`);
  return appliedParts;
}
