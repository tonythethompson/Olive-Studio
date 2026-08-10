/**
 * Sync structural preflight for Olive recipes (no env install, no Olive spawn).
 * Used by validate + submit before starting a job.
 *
 * QNN note: this path runs `assessQnnRecipeReadiness` **without** a live
 * `probe` (no `probeQnn` / venv). Host-mode, dynamic-shape, and export-target
 * failures still apply. NPU device and runtime-loadable checks require
 * `probe.qnn` and are enforced later in `startOliveJob` after the QNN venv is
 * ready — not here. Callers must not treat validate as hardware readiness.
 */
import { createHash } from "crypto";
import path from "path";
import { isValidReferenceModelPath } from "../../../lib/oliveRecipeBuilder.ts";
import { validateOliveRecipeStructure } from "../../../lib/oliveRecipeSchema.ts";
import { normalizeIhvProvider } from "../../../lib/venvFamily.ts";
import { isExportTargetProvider } from "../../../lib/providerRuntimeKind.ts";
import { resolveQnnHostMode } from "../../../lib/qnnDeps.ts";
import { assessQnnRecipeReadiness, isQnnIhvProvider } from "../../../lib/qnnReadiness.ts";
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
 * Validates that filesystem paths embedded in the recipe do not escape
 * the approved model root (`process.cwd()`). Rejects traversal segments, UNC
 * paths, and absolute paths that resolve outside the root.
 */
function validateRecipePaths(recipe: OliveRecipe): string[] {
  const errors: string[] = [];
  const cwd = process.cwd();

  function isUnsafePath(p: string, label: string): void {
    const trimmed = p.trim();
    if (!trimmed) return;
    if (!isValidReferenceModelPath(trimmed)) {
      errors.push(`${label}: path is not a safe reference model path (NUL or contains ..)`);
      return;
    }
    // Reject UNC paths (\\server\share)
    if (/^\\\\/.test(trimmed)) {
      errors.push(`${label}: UNC paths are not allowed`);
      return;
    }
    // Resolve and ensure under cwd (approved model root)
    const resolved = path.resolve(cwd, trimmed);
    if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
      errors.push(`${label}: path resolves outside the approved model root`);
    }
  }

  // Check pass configs for filesystem path parameters
  const passes = recipe.passes;
  if (passes && typeof passes === "object") {
    for (const [passName, passConfig] of Object.entries(passes)) {
      if (!passConfig || typeof passConfig !== "object") continue;
      const config = (passConfig as Record<string, unknown>).config;
      if (!config || typeof config !== "object") continue;
      const cfg = config as Record<string, unknown>;
      // reference_model_path (OnnxDiscrepancyCheck)
      if (typeof cfg.reference_model_path === "string") {
        isUnsafePath(cfg.reference_model_path, `passes.${passName}.config.reference_model_path`);
      }
      // model_path / data_dir / output_dir (common pass patterns)
      for (const key of ["model_path", "data_dir", "output_dir", "calibration_data_dir"] as const) {
        if (typeof cfg[key] === "string") {
          isUnsafePath(cfg[key], `passes.${passName}.config.${key}`);
        }
      }
    }
  }

  // Check input_model.config paths
  const inputModel = recipe.input_model;
  if (inputModel && typeof inputModel === "object") {
    const imConfig = (inputModel as Record<string, unknown>).config;
    if (imConfig && typeof imConfig === "object") {
      const imc = imConfig as Record<string, unknown>;
      if (typeof imc.model_path === "string") {
        isUnsafePath(imc.model_path, "input_model.config.model_path");
      }
    }
  }

  return errors;
}

/**
 * Validates an Olive recipe and performs static execution-provider checks.
 *
 * Does not install providers, probe GPUs/NPUs, or spawn Olive. For
 * `QNNExecutionProvider` on local-inference hosts, structural HTP checks run
 * here; NPU/runtime readiness is deferred to `startOliveJob` (see module note).
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

    if (isQnnIhvProvider(provider)) {
      const inputModel = recipe.input_model as { io_config?: unknown } | undefined;
      const hostMode = resolveQnnHostMode({ platform: process.platform, arch: process.arch });
      // Intentionally omit `probe`: sync validate must not touch the QNN venv.
      // assessQnnRecipeReadiness only emits npuDevice/loadable errors when probe
      // is present; startOliveJob supplies probe after probeQnn().
      const qnnIssues = assessQnnRecipeReadiness({
        state: { ihvProvider: provider, passes: DEFAULT_PASSES },
        ioConfig: inputModel?.io_config,
        hostMode,
        platform: { platform: process.platform, arch: process.arch },
      });
      errors.push(
        ...qnnIssues.filter((issue) => issue.severity === "error").map((issue) => issue.message),
      );
      warnings.push(
        ...qnnIssues
          .filter((issue) => issue.severity === "warning")
          .map((issue) => issue.message),
      );
      if (hostMode === "local-inference") {
        warnings.push(
          "QNN NPU/runtime readiness is not checked at validate time; startOliveJob probes the QNN venv before spawn and may still fail if NPU or onnxruntime-qnn is missing.",
        );
      }
    }
  }

  if (cudaVersion !== "auto" && !/^cu\d{3}$|^cpu$/.test(cudaVersion)) {
    warnings.push(`Unusual cudaVersion token: ${cudaVersion}`);
  }

  // ── Path constraint: reject recipe filesystem paths outside the model root ──
  const pathErrors = validateRecipePaths(recipe);
  errors.push(...pathErrors);

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
