import { validateRecipeSchema } from "@/lib/schemaEngine";

export interface OliveRecipeSchemaResult {
  valid: boolean;
  errors: string[];
}

/**
 * Structural Olive recipe validation shared by UI, server, and CI.
 *
 * Delegates to `validateRecipeSchema` in `schemaEngine.ts` — the unified
 * entry point that combines structural checks, pass catalog validation,
 * per-pass config validation, and system/accelerator reference validation.
 */
export function validateOliveRecipeStructure(recipe: unknown): OliveRecipeSchemaResult {
  return validateRecipeSchema(recipe);
}

export function assertValidOliveRecipeStructure(recipe: unknown): void {
  const result = validateOliveRecipeStructure(recipe);
  if (!result.valid) {
    throw new Error(`Invalid Olive recipe structure:\n- ${result.errors.join("\n- ")}`);
  }
}
