import type { UIState } from "@/types";

/**
 * Map a graph node ID and UI state to the concrete Olive pass type name
 * used in recipe JSON.
 *
 * This is the single source of truth for pass name resolution, used by
 * PassGuidanceCard, StepInspector, RecipeDiffOverlay, and the recipe builder.
 *
 * @param nodeId  The graph node identifier (e.g. "conversion", "quantization").
 * @param state   The current UI state.
 * @returns       The Olive pass type name, or undefined for nodes without a pass mapping.
 */
export function resolvePassName(nodeId: string, state: UIState): string | undefined {
  if (nodeId === "conversion") {
    if (state.passes.conversionFormat === "openvino") return "OpenVINOConversion";
    return "OnnxConversion";
  }
  if (nodeId === "quantization") {
    const m = state.passes.quantMethod;
    if (m === "awq") return "AutoAWQQuantizer";
    if (m === "gptq") return "GptqQuantizer";
    if (m === "qat") return "QATQuantizer";
    if (m === "hqq") return "OnnxHqqQuantization";
    if (m === "rtn") return "OnnxBlockWiseRtnQuantization";
    if (m === "spinquant") return "SpinQuant";
    if (m === "quarot") return "QuaRot";
    if (state.passes.conversionFormat === "openvino") return "OpenVINOQuantization";
    if (state.passes.conversionFormat === "qnn") return "QNNQuantization";
    return "OnnxQuantization";
  }
  if (nodeId === "pruning") {
    const m = state.passes.pruningMethod;
    if (m === "sparsegpt") return "SparseGPT";
    if (m === "wanda") return "Wanda";
    return "Prune";
  }
  if (nodeId === "peft") {
    return state.passes.peftMethod === "qlora" ? "QLoRA" : "LoRA";
  }
  if (nodeId === "splitting") return "SplitModel";
  if (nodeId === "transformer_opt") {
    if (state.passes.conversionFormat === "openvino") return "OpenVINOIoUpdate";
    if (state.passes.conversionFormat === "qnn") return "QNNPreprocess";
    return "OrtTransformersOptimization";
  }
  return undefined;
}
