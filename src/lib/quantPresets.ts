import { UIState } from "@/types";

const STORAGE_KEY = "olive-custom-quant-presets";

export interface CustomQuantPreset {
  label: string;
  description: string;
  fields: Partial<UIState["passes"]>;
  createdAt: number;
}

export function loadCustomPresets(): CustomQuantPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is CustomQuantPreset =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CustomQuantPreset).label === "string" &&
        typeof (item as CustomQuantPreset).fields === "object",
    );
  } catch {
    return [];
  }
}

export function saveCustomPreset(preset: CustomQuantPreset): void {
  const existing = loadCustomPresets();
  // Replace if label already exists, otherwise append
  const filtered = existing.filter((p) => p.label !== preset.label);
  filtered.push(preset);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function deleteCustomPreset(label: string): void {
  const existing = loadCustomPresets();
  const filtered = existing.filter((p) => p.label !== label);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // silently fail
  }
}

/** Replace all custom presets in localStorage (used by import). */
export function replaceAllCustomPresets(presets: CustomQuantPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // silently fail
  }
}

/** Serialize all custom presets to a JSON string for file download. */
export function exportPresetsJSON(presets: CustomQuantPreset[]): string {
  return JSON.stringify({ version: 1, presets }, null, 2);
}

/** Parse and validate a JSON string imported from a file.
 *  Returns the parsed presets on success, or an error message on failure. */
const KNOWN_QUANT_KEYS = new Set([
  "quantMethod",
  "quantPrecision",
  "gptqBlockSize",
  "gptqGroupSize",
  "gptqDescAct",
  "awqGroupSize",
  "awqDampPercent",
  "awqSym",
  "qatQuantPrecision",
  "qatCalibrateMethod",
  "qatCalibrateSteps",
]);

export function importPresetsJSON(
  json: string,
  existingPresets: CustomQuantPreset[],
):
  | { ok: true; presets: CustomQuantPreset[]; importedPresets: CustomQuantPreset[]; collisions: string[] }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Invalid JSON — could not parse file." };
  }

  // Accept both { version, presets } envelope and bare array for flexibility
  const raw: unknown =
    parsed && typeof parsed === "object" && "presets" in (parsed as Record<string, unknown>)
      ? (parsed as { presets: unknown }).presets
      : parsed;

  if (!Array.isArray(raw)) {
    return { ok: false, error: "File does not contain a preset array." };
  }

  const validated: CustomQuantPreset[] = [];
  for (const item of raw) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as CustomQuantPreset).label === "string" &&
      typeof (item as CustomQuantPreset).fields === "object"
    ) {
      // Filter to known quantization field keys to prevent storing invalid data
      const rawFields = (item as CustomQuantPreset).fields as Record<string, unknown>;
      const safeFields: Record<string, unknown> = {};
      for (const key of KNOWN_QUANT_KEYS) {
        if (key in rawFields) safeFields[key] = rawFields[key];
      }
      validated.push({
        ...item,
        fields: safeFields as Partial<UIState["passes"]>,
        createdAt:
          typeof (item as CustomQuantPreset).createdAt === "number"
            ? (item as CustomQuantPreset).createdAt
            : Date.now(),
      } as CustomQuantPreset);
    }
  }

  if (validated.length === 0) {
    return { ok: false, error: "No valid presets found in file." };
  }

  // Merge: imported presets overwrite existing ones with the same label
  const labelSet = new Map(validated.map((p) => [p.label, p]));
  for (const existing of existingPresets) {
    if (!labelSet.has(existing.label)) {
      labelSet.set(existing.label, existing);
    }
  }

  // Compute collisions: labels that exist in both imported and current presets
  const importedLabels = new Set(validated.map((p) => p.label));
  const collisionLabels = existingPresets.filter((p) => importedLabels.has(p.label)).map((p) => p.label);

  return {
    ok: true,
    presets: Array.from(labelSet.values()),
    importedPresets: validated,
    collisions: collisionLabels,
  };
}
