import type { UIState } from "@/types";

/** MobiusBuilder and QairtPipeline are single-pass HF/Torch export pipelines (not ONNX follow-ons). */
export function isReplacementExportPipeline(passes: UIState["passes"]): boolean {
  return passes.mobiusBuilder || passes.qairtPipeline;
}

/** Pass toggles that must be off while a replacement export pipeline is active. */
export const REPLACEMENT_PIPELINE_SUPPRESSED_PASSES: Partial<UIState["passes"]> = {
  conversion: false,
  onnxTransforms: false,
  splitting: false,
};

export function applyReplacementPipelinePassSuppression(
  passes: UIState["passes"],
): UIState["passes"] {
  if (!isReplacementExportPipeline(passes)) return passes;
  return { ...passes, ...REPLACEMENT_PIPELINE_SUPPRESSED_PASSES };
}
