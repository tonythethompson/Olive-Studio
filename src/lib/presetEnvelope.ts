/**
 * Shared parsing for preset import files (quant/pruning preset JSON).
 *
 * Import files may use either the `{ version, presets }` envelope produced by
 * the export functions or a bare preset array; both shapes are accepted here
 * so the import paths stay consistent across preset types.
 */

/**
 * Parses a preset import file and extracts the preset array.
 *
 * @param json - The raw JSON text of the imported file
 * @returns The preset entries as `unknown[]`, or an error when the file is not valid JSON or contains no preset array
 */
export function parsePresetEnvelope(json: string): { ok: true; raw: unknown[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Invalid JSON — could not parse file." };
  }

  // Accept both { version, presets } envelope and bare array
  const raw: unknown =
    parsed && typeof parsed === "object" && "presets" in (parsed as Record<string, unknown>)
      ? (parsed as { presets: unknown }).presets
      : parsed;

  if (!Array.isArray(raw)) {
    return { ok: false, error: "File does not contain a preset array." };
  }

  return { ok: true, raw };
}
