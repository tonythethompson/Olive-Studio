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

  const host = recipe.engine.host;
  if (typeof host === "string" && isObject(recipe.systems[host])) {
    const system = recipe.systems[host] as Record<string, unknown>;
    if (!requireObject(system.config, `systems.${host}.config`, errors)) {
      return { valid: false, errors };
    }
    const accelerators = (system.config as Record<string, unknown>).accelerators;
    if (!Array.isArray(accelerators) || accelerators.length === 0) {
      errors.push(`systems.${host}.config.accelerators must be a non-empty array`);
    } else {
      for (let i = 0; i < accelerators.length; i++) {
        const acc = accelerators[i];
        if (!isObject(acc)) {
          errors.push(`systems.${host}.config.accelerators[${i}] must be an object`);
          continue;
        }
        if (!requireString(acc.device, `systems.${host}.config.accelerators[${i}].device`, errors)) {
          continue;
        }
        if (!Array.isArray(acc.execution_providers) || acc.execution_providers.length === 0) {
          errors.push(
            `systems.${host}.config.accelerators[${i}].execution_providers must be a non-empty array`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidOliveRecipeStructure(recipe: unknown): void {
  const result = validateOliveRecipeStructure(recipe);
  if (!result.valid) {
    throw new Error(`Invalid Olive recipe structure:\n- ${result.errors.join("\n- ")}`);
  }
}
