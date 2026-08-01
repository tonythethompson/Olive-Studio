import { BatchJob, UIState } from "@/types";
import { buildOliveRecipe } from "@/lib/oliveRecipeBuilder";
import {
  getPipelineValidation,
  getLocalExecutionIssues,
  getRemainingAdvisories,
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
  isRunnable: boolean;
}

/** Single source of truth: UI state → sanitized recipe artifact. */
export function buildRecipeFromState(
  state: UIState,
  options?: PipelineValidationOptions,
): RecipePipelineResult {
  const sanitized = sanitizePipelineState(state);
  const recipe = buildOliveRecipe(sanitized);
  const recipeJson = serializeRecipe(recipe);
  const validation = getPipelineValidation(sanitized, options);
  const localExecutionIssues = getLocalExecutionIssues(sanitized, true);
  const schema = validateOliveRecipeStructure(recipe);

  return {
    state: sanitized,
    recipe,
    recipeJson,
    validation,
    schema,
    advisories: getRemainingAdvisories(sanitized),
    isRunnable: !validation.isBlocked && localExecutionIssues.length === 0 && schema.valid,
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
