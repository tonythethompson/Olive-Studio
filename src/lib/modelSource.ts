import type { ModelSource, UIState } from "@/types";

export type EffectiveModelSource = ModelSource;

/**
 * Resolves which model source actually has a model configured, preferring
 * the active `modelSource` tab but falling back to any other source that
 * already has a model. This keeps the loaded model "active" while the user
 * browses a different source tab without yet providing input: switching to
 * "Local" right after loading a Hugging Face recipe should not discard the
 * loaded model from the VRAM panel or the status summary.
 *
 * Returns `null` when no source has any model configured at all.
 */
export function getEffectiveModelSource(state: UIState): EffectiveModelSource | null {
  // Defensive against partial / loosely-typed states (some callers pass a
  // minimal snapshot): coerce missing fields to their empty equivalents so
  // the checks never throw on `undefined`.
  const hfModelId = state.hfModelId ?? "";
  const azureModelPath = state.azureModelPath ?? "";
  const localFiles = state.localFiles ?? [];

  const active = state.modelSource;
  if (active === "huggingface" && hfModelId.trim() !== "") return active;
  if (active === "local" && localFiles.length > 0) return active;
  if (active === "azure" && azureModelPath.trim() !== "") return active;

  // Active tab has no model yet: fall back to any source that does, so the
  // previously loaded model stays in effect until the user provides new input.
  if (hfModelId.trim() !== "") return "huggingface";
  if (localFiles.length > 0) return "local";
  if (azureModelPath.trim() !== "") return "azure";
  return null;
}
