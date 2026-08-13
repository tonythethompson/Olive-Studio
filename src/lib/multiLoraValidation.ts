/**
 * MultiLoRA adapter validation utilities.
 *
 * Validates adapter entries for multi-LoRA configurations, enforcing constraints
 * on name uniqueness, path presence, numeric field validity, and VRAM-based
 * adapter count limits.
 *
 * Gated behind the `multiLora` feature flag — when disabled, the recipe builder
 * rejects multi-adapter configurations and operates in single-adapter mode.
 *
 * @module multiLoraValidation
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A validated LoRA adapter entry.
 */
export interface AdapterEntry {
  /** Unique adapter name within the configuration. */
  name: string;
  /** Filesystem path to the adapter weights. */
  path: string;
  /** LoRA rank (positive integer). */
  rank: number;
  /** LoRA alpha scaling factor (positive finite number). */
  alpha: number;
  /** Optional target module names for adapter injection. */
  targetModules?: string[];
}

/**
 * A single validation error identifying the adapter index and invalid field.
 */
export interface ValidationError {
  /** Index of the adapter entry in the input array. */
  index: number;
  /** Field name that failed validation. */
  field: string;
  /** Human-readable error description. */
  message: string;
}

/**
 * Result of adapter array validation.
 * When valid, `adapters` contains the parsed entries. When invalid, `errors`
 * describes each failed constraint.
 */
export interface ValidationResult {
  /** Whether the entire adapter array passed validation. */
  valid: boolean;
  /** Per-entry validation errors (empty when valid). */
  errors: ValidationError[];
  /** Parsed adapter entries (populated only when valid). */
  adapters: AdapterEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** VRAM threshold (GB) below or equal to which a lower adapter limit applies. */
const LOW_VRAM_THRESHOLD_GB = 12;

/** Maximum adapter count for hardware with <= 12 GB VRAM. */
const LOW_VRAM_MAX_ADAPTERS = 2;

/** Maximum adapter count for hardware with > 12 GB VRAM. */
const HIGH_VRAM_MAX_ADAPTERS = 8;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Returns the maximum number of adapters allowed given the available VRAM.
 *
 * @param vramGb - Available VRAM in gigabytes
 * @returns Maximum adapter count (2 for <= 12 GB, 8 for > 12 GB)
 */
export function getMaxAdapterCount(vramGb: number): number {
  // Non-finite values (NaN, Infinity) get the restrictive limit
  if (!Number.isFinite(vramGb)) return LOW_VRAM_MAX_ADAPTERS;
  return vramGb <= LOW_VRAM_THRESHOLD_GB
    ? LOW_VRAM_MAX_ADAPTERS
    : HIGH_VRAM_MAX_ADAPTERS;
}

/**
 * Validates an array of adapter entries against MultiLoRA constraints.
 *
 * Validation rules:
 * 1. `name`: non-empty string, unique across all entries
 * 2. `path`: non-empty string
 * 3. `rank`: positive integer (> 0, Number.isInteger)
 * 4. `alpha`: positive finite number (> 0, Number.isFinite)
 * 5. `targetModules`: if present, must be an array of non-empty strings
 * 6. Max adapter count: 2 for <= 12 GB VRAM, 8 for > 12 GB VRAM
 * 7. Duplicate name detection: identify both conflicting indices
 *
 * @param adapters - Untyped adapter entries from runtime input
 * @param vramGb - Available VRAM in gigabytes for enforcing adapter count limits
 * @returns Validation result with parsed adapters (when valid) or errors (when invalid)
 */
export function validateAdapters(
  adapters: unknown[],
  vramGb: number,
): ValidationResult {
  const errors: ValidationError[] = [];
  const maxCount = getMaxAdapterCount(vramGb);

  // Check adapter count limit
  if (adapters.length > maxCount) {
    errors.push({
      index: -1,
      field: "adapters",
      message: `Adapter count ${adapters.length} exceeds maximum of ${maxCount} for ${vramGb <= LOW_VRAM_THRESHOLD_GB ? "<= 12" : "> 12"} GB VRAM`,
    });
  }

  // Track names for duplicate detection
  const nameToIndices = new Map<string, number[]>();

  // Validate each entry
  for (let i = 0; i < adapters.length; i++) {
    const entry = adapters[i];

    // Entry must be a non-null object
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push({
        index: i,
        field: "entry",
        message: `Adapter at index ${i} must be a non-null object`,
      });
      continue;
    }

    const obj = entry as Record<string, unknown>;

    // Validate name: non-empty string
    if (typeof obj.name !== "string" || obj.name.length === 0) {
      errors.push({
        index: i,
        field: "name",
        message: `Adapter at index ${i}: name must be a non-empty string`,
      });
    } else {
      // Track for duplicate detection
      const existing = nameToIndices.get(obj.name);
      if (existing) {
        existing.push(i);
      } else {
        nameToIndices.set(obj.name, [i]);
      }
    }

    // Validate path: non-empty string
    if (typeof obj.path !== "string" || obj.path.length === 0) {
      errors.push({
        index: i,
        field: "path",
        message: `Adapter at index ${i}: path must be a non-empty string`,
      });
    }

    // Validate rank: positive integer
    if (
      typeof obj.rank !== "number" ||
      !Number.isInteger(obj.rank) ||
      obj.rank <= 0
    ) {
      errors.push({
        index: i,
        field: "rank",
        message: `Adapter at index ${i}: rank must be a positive integer`,
      });
    }

    // Validate alpha: positive finite number
    if (
      typeof obj.alpha !== "number" ||
      !Number.isFinite(obj.alpha) ||
      obj.alpha <= 0
    ) {
      errors.push({
        index: i,
        field: "alpha",
        message: `Adapter at index ${i}: alpha must be a positive finite number`,
      });
    }

    // Validate targetModules: if present, must be an array of non-empty strings
    if (obj.targetModules !== undefined) {
      if (!Array.isArray(obj.targetModules)) {
        errors.push({
          index: i,
          field: "targetModules",
          message: `Adapter at index ${i}: targetModules must be an array of non-empty strings`,
        });
      } else {
        const allValid = obj.targetModules.every(
          (m: unknown) => typeof m === "string" && m.length > 0,
        );
        if (!allValid) {
          errors.push({
            index: i,
            field: "targetModules",
            message: `Adapter at index ${i}: targetModules must contain only non-empty strings`,
          });
        }
      }
    }
  }

  // Detect and report duplicate names
  for (const [name, indices] of nameToIndices) {
    if (indices.length > 1) {
      errors.push({
        index: indices[0],
        field: "name",
        message: `Duplicate adapter name "${name}" found at indices ${indices.join(", ")}`,
      });
    }
  }

  // Build result
  if (errors.length > 0) {
    return { valid: false, errors, adapters: [] };
  }

  // Parse valid entries
  const parsed: AdapterEntry[] = adapters.map((entry) => {
    const obj = entry as Record<string, unknown>;
    const result: AdapterEntry = {
      name: obj.name as string,
      path: obj.path as string,
      rank: obj.rank as number,
      alpha: obj.alpha as number,
    };
    if (obj.targetModules !== undefined) {
      result.targetModules = obj.targetModules as string[];
    }
    return result;
  });

  return { valid: true, errors: [], adapters: parsed };
}
