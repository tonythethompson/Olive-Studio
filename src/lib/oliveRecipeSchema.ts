import { validateRecipeSchema } from "@/lib/schemaEngine";

export interface OliveRecipeSchemaResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the structural integrity of an Olive recipe.
 *
 * @param recipe - The recipe value to validate
 * @returns Validation status and any structural errors
 */
export function validateOliveRecipeStructure(recipe: unknown): OliveRecipeSchemaResult {
  return validateRecipeSchema(recipe);
}

/**
 * Asserts that an Olive recipe has a valid structure.
 *
 * @param recipe - The recipe structure to validate
 * @throws {Error} If the recipe structure is invalid
 */
export function assertValidOliveRecipeStructure(recipe: unknown): void {
  const result = validateOliveRecipeStructure(recipe);
  if (!result.valid) {
    throw new Error(`Invalid Olive recipe structure:\n- ${result.errors.join("\n- ")}`);
  }
}
