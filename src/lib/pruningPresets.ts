import { UIState } from "@/types";
import { parsePresetEnvelope } from "@/lib/presetEnvelope";

const STORAGE_KEY = "olive-pruning-custom-presets";

export interface CustomPruningPreset {
  id: string;
  label: string;
  method: UIState["passes"]["pruningMethod"];
  criteria: UIState["passes"]["pruningCriteria"];
  sparsity: number;
}

export function loadCustomPresets(): CustomPruningPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is CustomPruningPreset =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CustomPruningPreset).id === "string" &&
        typeof (item as CustomPruningPreset).label === "string" &&
        typeof (item as CustomPruningPreset).method === "string" &&
        typeof (item as CustomPruningPreset).criteria === "string" &&
        typeof (item as CustomPruningPreset).sparsity === "number",
    );
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: CustomPruningPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

/** Replace all custom presets in localStorage (used by import). */
export function replaceAllCustomPresets(presets: CustomPruningPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // silently fail
  }
}

/** Serialize all custom presets to a JSON string for file download. */
export function exportPresetsJSON(presets: CustomPruningPreset[]): string {
  return JSON.stringify({ version: 1, presets }, null, 2);
}

const VALID_METHODS = new Set(["magnitude", "sparsegpt", "wanda"]);
const VALID_CRITERIA = new Set(["l1_norm", "l2_norm"]);

/** Parse and validate a JSON string imported from a file. */
export function importPresetsJSON(
  json: string,
  existingPresets: CustomPruningPreset[],
):
  | { ok: true; presets: CustomPruningPreset[]; importedPresets: CustomPruningPreset[]; collisions: string[] }
  | { ok: false; error: string } {
  const envelope = parsePresetEnvelope(json);
  if (!envelope.ok) return { ok: false, error: envelope.error };
  const raw = envelope.raw;

  const validated: CustomPruningPreset[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.label !== "string" || !obj.label) continue;
    if (typeof obj.method !== "string" || !VALID_METHODS.has(obj.method as string)) continue;
    if (typeof obj.criteria !== "string" || !VALID_CRITERIA.has(obj.criteria as string)) continue;
    if (typeof obj.sparsity !== "number" || obj.sparsity < 0 || obj.sparsity >= 1) continue;

    validated.push({
      id:
        typeof obj.id === "string"
          ? obj.id
          : `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: obj.label as string,
      method: obj.method as UIState["passes"]["pruningMethod"],
      criteria: obj.criteria as UIState["passes"]["pruningCriteria"],
      sparsity: obj.sparsity as number,
    });
  }

  if (validated.length === 0) {
    return { ok: false, error: "No valid presets found in file." };
  }

  // Merge: imported presets overwrite existing ones with the same label
  const labelMap = new Map(validated.map((p) => [p.label, p]));
  for (const existing of existingPresets) {
    if (!labelMap.has(existing.label)) {
      labelMap.set(existing.label, existing);
    }
  }

  // Compute collisions: labels that exist in both imported and current presets
  const importedLabels = new Set(validated.map((p) => p.label));
  const collisionLabels = existingPresets.filter((p) => importedLabels.has(p.label)).map((p) => p.label);

  return {
    ok: true,
    presets: Array.from(labelMap.values()),
    importedPresets: validated,
    collisions: collisionLabels,
  };
}
