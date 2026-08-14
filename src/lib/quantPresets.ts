import { UIState } from "@/types";
import { parsePresetEnvelope } from "@/lib/presetEnvelope";

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
  const envelope = parsePresetEnvelope(json);
  if (!envelope.ok) return { ok: false, error: envelope.error };
  const raw = envelope.raw;

  const validated: CustomQuantPreset[] = [];
  for (const item of raw) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as CustomQuantPreset).label === "string" &&
      typeof (item as CustomQuantPreset).fields === "object" &&
      (item as CustomQuantPreset).fields !== null
    ) {
      // Filter to known quantization field keys to prevent storing invalid data
      const rawFields = (item as CustomQuantPreset).fields as Record<string, unknown>;
      const safeFields: Record<string, unknown> = {};
      for (const key of KNOWN_QUANT_KEYS) {
        if (key in rawFields) {
          const value = rawFields[key];
          // Validate specific fields
          if (key === "quantPrecision") {
            if (value !== "int4" && value !== "int8" && value !== "fp16") continue;
          } else if (key === "qatQuantPrecision") {
            if (value !== "int4" && value !== "int8") continue;
          } else if (key === "qatCalibrateSteps") {
            if (typeof value !== "number" || !Number.isFinite(value)) continue;
          } else if (key === "gptqBlockSize" || key === "gptqGroupSize" || key === "awqGroupSize") {
            if (typeof value !== "number" || !Number.isFinite(value)) continue;
          } else if (key === "awqDampPercent") {
            if (typeof value !== "number" || !Number.isFinite(value)) continue;
          }
          safeFields[key] = value;
        }
      }
      validated.push({
        label: (item as CustomQuantPreset).label,
        description: typeof (item as { description?: unknown }).description === "string"
          ? (item as { description: string }).description
          : "",
        fields: safeFields as Partial<UIState["passes"]>,
        createdAt:
          typeof (item as CustomQuantPreset).createdAt === "number"
            ? (item as CustomQuantPreset).createdAt
            : Date.now(),
      });
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
