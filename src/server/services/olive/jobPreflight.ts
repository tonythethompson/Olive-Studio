/**
 * Sync structural preflight for Olive recipes (no env install, no Olive spawn).
 * Used by validate + submit before starting a job.
 */
import { createHash } from "crypto";
import { validateOliveRecipeStructure } from "../../../lib/oliveRecipeSchema.ts";
import { normalizeIhvProvider } from "../../../lib/venvFamily.ts";
import { isExportTargetProvider } from "../../../lib/providerRuntimeKind.ts";
import { resolveQnnHostMode } from "../../../lib/qnnDeps.ts";
import { assessQnnRecipeReadiness } from "../../../lib/qnnReadiness.ts";
import { DEFAULT_PASSES } from "../../../lib/defaultPasses.ts";
import type { OliveRecipe } from "../../types.ts";
import type { IHVProvider } from "../../../types.ts";

export type PreflightResult = {
  valid: boolean;
  fingerprint: string;
  provider: IHVProvider | null;
  errors: string[];
  warnings: string[];
  /** Recipe with canonical EP token applied (same object mutated safely). */
  recipe: OliveRecipe;
  cudaVersion: string;
};

/**
 * Serializes a value deterministically for consistent comparisons and fingerprints.
 *
 * @returns A JSON-compatible string with object keys sorted and properties with `undefined` values omitted.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  // Match JSON.stringify: omit keys whose values are undefined.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Computes a deterministic SHA-256 fingerprint for a recipe and CUDA version.
 *
 * @param recipe - The recipe to fingerprint
 * @param cudaVersion - The CUDA version associated with the recipe
 * @returns The hexadecimal SHA-256 fingerprint
 */
export function fingerprintRecipe(recipe: unknown, cudaVersion = "auto"): string {
  const payload = `${stableStringify(recipe)}\0${cudaVersion}`;
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Validates an Olive recipe and performs static execution-provider checks.
 *
 * @param recipeInput - The Olive recipe to validate and normalize.
 * @param cudaVersion - The CUDA version token used for fingerprinting and diagnostics.
 * @returns Validation status, diagnostics, normalized provider and recipe, fingerprint, and CUDA version.
 */
export function preflightOliveRecipe(
  recipeInput: OliveRecipe,
  cudaVersion = "auto",
): PreflightResult {
  // Clone so callers can keep the original; we may normalize EP in place on the clone.
  const recipe = JSON.parse(JSON.stringify(recipeInput)) as OliveRecipe;
  const errors: string[] = [];
  const warnings: string[] = [];

  const validation = validateOliveRecipeStructure(recipe);
  if (!validation.valid) {
    errors.push(...validation.errors);
  }

  // Olive recipes may place accelerators under systems.local_system.config
  // or directly under systems.local_system (both shapes are in OliveRecipe).
  const localSystem = recipe.systems?.local_system;
  const accelFromConfig = localSystem?.config?.accelerators?.[0];
  const accelFromTop = localSystem?.accelerators?.[0];
  const accel = accelFromConfig ?? accelFromTop;
  const providerRaw = accel?.execution_providers?.[0] ?? "CPUExecutionProvider";
  const provider = normalizeIhvProvider(providerRaw);
  if (!provider) {
    errors.push(`Unknown execution provider: ${String(providerRaw)}`);
  } else {
    if (accel && Array.isArray(accel.execution_providers) && accel.execution_providers.length > 0) {
      accel.execution_providers[0] = provider;
    }

    if (isExportTargetProvider(provider)) {
      errors.push(
        `${provider} cannot run via local Olive Python; export the recipe for the target runtime instead`,
      );
    }

    if (provider === "QNNExecutionProvider") {
      const inputModel = recipe.input_model as { io_config?: unknown } | undefined;
      const hostMode = resolveQnnHostMode({ platform: process.platform, arch: process.arch });
      const hardFailures = assessQnnRecipeReadiness({
        state: { ihvProvider: provider, passes: DEFAULT_PASSES },
        ioConfig: inputModel?.io_config,
        hostMode,
        platform: { platform: process.platform, arch: process.arch },
      }).filter((issue) => issue.severity === "error");
      if (hardFailures.length > 0) {
        errors.push(...hardFailures.map((issue) => issue.message));
      }
    }
  }

  if (cudaVersion !== "auto" && !/^cu\d{3}$|^cpu$/.test(cudaVersion)) {
    warnings.push(`Unusual cudaVersion token: ${cudaVersion}`);
  }

  const fingerprint = fingerprintRecipe(recipe, cudaVersion);
  return {
    valid: errors.length === 0,
    fingerprint,
    provider: provider ?? null,
    errors,
    warnings,
    recipe,
    cudaVersion,
  };
}
