import type { UIState } from "@/types";
import { isPeftAllowed } from "@/lib/pipelineValidation";
import { getPeftBlockReason } from "@/lib/modelFamily";

const TOGGLEABLE_PASSES = [
  "splitting",
  "peft",
  "conversion",
  "pruning",
  "transformer_opt",
  "quantization",
] as const;

export type ToggleablePassId = (typeof TOGGLEABLE_PASSES)[number];

export function isToggleablePass(nodeId: string): nodeId is ToggleablePassId {
  return (TOGGLEABLE_PASSES as readonly string[]).includes(nodeId);
}

export function getPassToggleBlockReason(
  nodeId: string,
  state: UIState,
  activating: boolean,
): string | null {
  if (!activating) return null;

  if (nodeId === "peft" && !isPeftAllowed(state.ihvProvider)) {
    return getPeftBlockReason(state.ihvProvider);
  }

  if (nodeId === "pruning" && state.passes.quantMethod === "awq") {
    return "Pruning cannot run with AWQ — switch quantization to PTQ first.";
  }

  return null;
}

export function togglePassInState(state: UIState, nodeId: ToggleablePassId): UIState["passes"] {
  const updatedPasses = { ...state.passes };

  switch (nodeId) {
    case "conversion":
      updatedPasses.conversion = !updatedPasses.conversion;
      break;
    case "pruning":
      updatedPasses.pruning = !updatedPasses.pruning;
      break;
    case "transformer_opt":
      updatedPasses.onnxTransforms = !updatedPasses.onnxTransforms;
      break;
    case "quantization":
      updatedPasses.quantization = !updatedPasses.quantization;
      break;
    case "splitting":
      updatedPasses.splitting = !updatedPasses.splitting;
      break;
    case "peft":
      updatedPasses.peft = !updatedPasses.peft;
      break;
    default: {
      const _exhaustive: never = nodeId;
      return state.passes;
    }
  }

  return updatedPasses;
}
