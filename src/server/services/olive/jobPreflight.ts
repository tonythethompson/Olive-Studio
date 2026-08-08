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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** SHA-256 fingerprint of canonical recipe + cudaVersion. */
export function fingerprintRecipe(recipe: unknown, cudaVersion = "auto"): string {
  const payload = `${stableStringify(recipe)}\0${cudaVersion}`;
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Structural validation + static provider checks. Does not touch venv or spawn Olive.
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

  const providerRaw =
    recipe.systems?.local_system?.config?.accelerators?.[0]?.execution_providers?.[0] ??
    "CPUExecutionProvider";
  const provider = normalizeIhvProvider(providerRaw);
  if (!provider) {
    errors.push(`Unknown execution provider: ${String(providerRaw)}`);
  } else {
    const accel = recipe.systems?.local_system?.config?.accelerators?.[0];
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
