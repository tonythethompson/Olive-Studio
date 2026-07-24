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
