import { BatchJob, UIState } from "@/types";
import {
  getPipelineValidation,
  getLocalExecutionIssues,
  getRemainingAdvisories,
  PipelineIssue,
  PipelineValidationResult,
  PipelineValidationOptions,
  sanitizePipelineState,
} from "@/lib/pipelineValidation";
import { OliveRecipeSchemaResult, validateOliveRecipeStructure } from "@/lib/oliveRecipeSchema";

export interface RecipePipelineResult {
  state: UIState;
  recipe: Record<string, unknown>;
  recipeJson: string;
  validation: PipelineValidationResult;
  schema: OliveRecipeSchemaResult;
  advisories: ReturnType<typeof getRemainingAdvisories>;
  /** Local-only blockers (e.g. WebGPU Execute Live) not covered by graph validation alone. */
  localExecutionIssues: ReturnType<typeof getLocalExecutionIssues>;
  isRunnable: boolean;
}

/**
 * JSON-safe UIState recipe evaluation for the MCP / studio-recipe bridge.
 * Plain data only — safe to `JSON.stringify` without custom replacers.
 */
export interface UiStateRecipeEvaluation {
  /** Sanitized state after coerce/autofix (same as `buildRecipeFromState().state`). */
  effectiveState: UIState;
  /** Built Olive recipe object. */
  recipe: Record<string, unknown>;
  /** Structural schema validation errors (empty when valid). */
  schemaErrors: string[];
  /** Full pipeline issue list from validation. */
  pipelineIssues: PipelineIssue[];
  /** Count of critical pipeline issues. */
  criticalCount: number;
  /** Count of warning-severity pipeline issues. */
  warningCount: number;
  /** Whether the pipeline has critical blockers. */
  isBlocked: boolean;
  /** Remaining advisories (warning severity, no autofix). */
  advisories: PipelineIssue[];
  /** Local-only execution blockers (e.g. WebGPU Execute Live). */
  localExecutionIssues: PipelineIssue[];
  /** All warning-severity pipeline issues (includes autofixable warnings). */
  warnings: PipelineIssue[];
  /** True when schema is valid, pipeline is not blocked, and no local-execution issues. */
  isRunnable: boolean;
}

/**
 * Builds a sanitized Olive recipe artifact and evaluates its validation status.
 *
 * @param state - The UI state used to construct the recipe
 * @param options - Optional settings for pipeline validation
 * @returns The sanitized state, recipe, serialized JSON, validation results, advisories, schema status, and runnability
 */
export function buildRecipeFromState(
  state: UIState,
  options?: PipelineValidationOptions,
): RecipePipelineResult {
  const sanitized = sanitizePipelineState(state);
  const validation = getPipelineValidation(sanitized, options);
  // Reuse the recipe getPipelineValidation already built instead of rebuilding.
  const recipe = validation.recipe as unknown as Record<string, unknown>;
  const recipeJson = serializeRecipe(recipe);
  const localExecutionIssues = getLocalExecutionIssues(sanitized, true, options?.hardwareProbe);
  const schema = validateOliveRecipeStructure(recipe);

  return {
    state: sanitized,
    recipe,
    recipeJson,
    validation,
    schema,
    // Same filter as getRemainingAdvisories, without re-running validation.
    advisories: validation.issues.filter((issue) => issue.severity === "warning" && !issue.autofix),
    localExecutionIssues,
    isRunnable: !validation.isBlocked && localExecutionIssues.length === 0 && schema.valid,
  };
}

/**
 * Project UIState into a stable, JSON-safe recipe evaluation payload for the
 * MCP / studio-recipe bridge. Wraps {@link buildRecipeFromState}; pure — no I/O,
 * temp files, or Olive execution.
 *
 * @param state - The UI state to evaluate
 * @param options - Optional pipeline validation settings (e.g. hardware probe)
 */
export function projectUiStateToRecipeEvaluation(
  state: UIState,
  options?: PipelineValidationOptions,
): UiStateRecipeEvaluation {
  const {
    state: effectiveState,
    recipe,
    validation,
    schema,
    advisories,
    localExecutionIssues,
    isRunnable,
  } = buildRecipeFromState(state, options);

  return {
    effectiveState,
    recipe,
    schemaErrors: [...schema.errors],
    pipelineIssues: [...validation.issues],
    criticalCount: validation.criticalCount,
    warningCount: validation.warningCount,
    isBlocked: validation.isBlocked,
    advisories: [...advisories],
    localExecutionIssues: [...localExecutionIssues],
    warnings: validation.issues.filter((issue) => issue.severity === "warning"),
    isRunnable,
  };
}

export function serializeRecipe(recipe: Record<string, unknown>): string {
  return JSON.stringify(recipe, null, 2);
}

export function buildRecipeJsonFromState(state: UIState): string {
  return buildRecipeFromState(state).recipeJson;
}

export function buildOliveRecipeFromBatchJob(
  job: Pick<BatchJob, "modelSource" | "modelIdentifier" | "provider" | "recipeJson">,
  fallbackState: UIState,
): Record<string, unknown> {
  if (job.recipeJson) {
    try {
      const parsed = JSON.parse(job.recipeJson) as Record<string, unknown>;
      const schema = validateOliveRecipeStructure(parsed);
      if (schema.valid) {
        return parsed;
      }
    } catch {
      /* fall through */
    }
  }

  return buildRecipeFromState({
    ...fallbackState,
    modelSource: job.modelSource,
    hfModelId: job.modelSource === "huggingface" ? job.modelIdentifier : fallbackState.hfModelId,
    azureModelPath: job.modelSource === "azure" ? job.modelIdentifier : fallbackState.azureModelPath,
    ihvProvider: job.provider,
  }).recipe;
}

/** Parse imported JSON and validate structure (compatibility sanitization happens via setState). */
export function parseRecipeJson(text: string): {
  recipe: Record<string, unknown>;
  schema: OliveRecipeSchemaResult;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return { recipe: {}, schema: { valid: false, errors: [`JSON syntax error: ${message}`] } };
  }

  const schema = validateOliveRecipeStructure(parsed);
  return {
    recipe: isObject(parsed) ? parsed : {},
    schema,
  };
}

export function assertRunnableRecipe(state: UIState): RecipePipelineResult {
  const pipeline = buildRecipeFromState(state);
  if (!pipeline.schema.valid) {
    throw new Error(`Recipe schema invalid:\n- ${pipeline.schema.errors.join("\n- ")}`);
  }
  if (pipeline.validation.isBlocked) {
    throw new Error(
      `Pipeline blocked: ${pipeline.validation.criticalCount} compatibility issue(s) remain after sanitization`,
    );
  }
  return pipeline;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
