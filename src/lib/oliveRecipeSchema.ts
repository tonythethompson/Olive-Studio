import { isKnownPassName } from "@/lib/passCatalog";

export interface OliveRecipeSchemaResult {
  valid: boolean;
  errors: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function requireString(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

/** Structural Olive recipe validation shared by UI, server, and CI. */
export function validateOliveRecipeStructure(recipe: unknown): OliveRecipeSchemaResult {
  const errors: string[] = [];

  if (!requireObject(recipe, "recipe", errors)) {
    return { valid: false, errors };
  }

  const inputModel = recipe.input_model;
  if (!requireObject(inputModel, "input_model", errors)) {
    return { valid: false, errors };
  }
  if (!requireString(inputModel.type, "input_model.type", errors)) {
    return { valid: false, errors };
  }
  if (!requireObject(inputModel.config, "input_model.config", errors)) {
    return { valid: false, errors };
  }

  if (!requireObject(recipe.systems, "systems", errors)) {
    return { valid: false, errors };
  }

  if (!requireObject(recipe.passes, "passes", errors)) {
    return { valid: false, errors };
  }

  for (const [passName, passValue] of Object.entries(recipe.passes)) {
    if (!requireObject(passValue, `passes.${passName}`, errors)) {
      continue;
    }
    if (!requireString(passValue.type, `passes.${passName}.type`, errors)) {
      continue;
    }
    if (passValue.config !== undefined && !isObject(passValue.config)) {
      errors.push(`passes.${passName}.config must be an object when present`);
    }
    // Validate pass type name against the 0.12.1 pass catalog
    if (!isKnownPassName(passValue.type)) {
      errors.push(
        `passes.${passName}.type "${passValue.type}" is not a known Olive 0.12.1 pass. ` +
          `Run \`olive run-pass --list-passes\` to see the full list.`,
      );
    }
  }

  if (!requireObject(recipe.engine, "engine", errors)) {
    return { valid: false, errors };
  }
  if (!requireString(recipe.engine.host, "engine.host", errors)) {
    return { valid: false, errors };
  }
  if (!requireString(recipe.engine.target, "engine.target", errors)) {
    return { valid: false, errors };
  }

  function validateSystemRef(systems: Record<string, unknown>, ref: string, label: string): void {
    const system = systems[ref];
    if (!isObject(system)) {
      errors.push(`engine.${label} references "${ref}" which is not a valid system key`);
      return;
    }
    const typed = system as Record<string, unknown>;
    if (!requireObject(typed.config, `systems.${ref}.config`, errors)) {
      return;
    }
    const accelerators = (typed.config as Record<string, unknown>).accelerators;
    if (!Array.isArray(accelerators) || accelerators.length === 0) {
      errors.push(`systems.${ref}.config.accelerators must be a non-empty array`);
    } else {
      for (let i = 0; i < accelerators.length; i++) {
        const acc = accelerators[i];
        if (!isObject(acc)) {
          errors.push(`systems.${ref}.config.accelerators[${i}] must be an object`);
          continue;
        }
        if (!requireString(acc.device, `systems.${ref}.config.accelerators[${i}].device`, errors)) {
          continue;
        }
        if (!Array.isArray(acc.execution_providers) || acc.execution_providers.length === 0) {
          errors.push(
            `systems.${ref}.config.accelerators[${i}].execution_providers must be a non-empty array`,
          );
        }
      }
    }
  }

  validateSystemRef(recipe.systems, recipe.engine.host, "host");
  validateSystemRef(recipe.systems, recipe.engine.target, "target");

  return { valid: errors.length === 0, errors };
}

export function assertValidOliveRecipeStructure(recipe: unknown): void {
  const result = validateOliveRecipeStructure(recipe);
  if (!result.valid) {
    throw new Error(`Invalid Olive recipe structure:\n- ${result.errors.join("\n- ")}`);
  }
}
