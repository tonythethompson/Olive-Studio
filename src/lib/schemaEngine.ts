/**
 * Unified Schema Engine — hybrid codegen + runtime validation.
 *
 * Merges the static TypeScript pass catalog (`passCatalog.ts`) with the MCP
 * knowledge-base parameter schemas (`passes.json`) into a single source of
 * truth for Olive pass validation.
 *
 * - `getPassSchema(name)` returns the full pass schema including parameter defs.
 * - `validatePassConfig(passType, config)` validates a pass config object against
 *   its parameter schema (type checking, enum enforcement, required params).
 * - `validateRecipeSchema(recipe)` performs full structural + per-pass config
 *   validation, superseding the basic checks in `oliveRecipeSchema.ts`.
 */

import { isKnownPassName, getPassCatalogEntry, type PassCatalogEntry } from "@/lib/passCatalog";
import passKnowledgeBase from "../../olive-mcp-server/olive_mcp_server/knowledge_base/passes.json";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ParamType = "str" | "int" | "float" | "bool" | "dict" | "list[str]" | "list[int]" | "list[float]";

export interface ParamSchema {
  type: ParamType;
  default: unknown;
  enum?: string[];
  range?: string;
  description?: string;
}

export interface PassParamSchema {
  name: string;
  type: string;
  class?: string;
  description: string;
  input_formats: string[];
  output_formats: string[];
  required_params: string[];
  optional_params: Record<string, ParamSchema>;
  hardware_requirements: string[];
  typical_compression?: string;
  gotchas?: string[];
}

export interface UnifiedPassSchema extends PassCatalogEntry {
  params: Record<string, ParamSchema>;
  requiredParams: string[];
  hardwareRequirements: string[];
  gotchas: string[];
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Knowledge-base index ──────────────────────────────────────────────────────

interface PassesJson {
  passes?: Array<{
    name: string;
    type?: string;
    class?: string;
    description?: string;
    input_formats?: string[];
    output_formats?: string[];
    required_params?: string[];
    optional_params?: Record<string, ParamSchema>;
    hardware_requirements?: string[];
    typical_compression?: string;
    gotchas?: string[];
  }>;
}

const kb = passKnowledgeBase as PassesJson;

/** Map of pass name → parameter schema from passes.json */
let PARAM_SCHEMAS: Map<string, PassParamSchema> = buildParamSchemas(kb);

function buildParamSchemas(data: PassesJson): Map<string, PassParamSchema> {
  return new Map(
    (data.passes ?? []).map((p) => [
      p.name,
      {
        name: p.name,
        type: p.type ?? "unknown",
        class: p.class,
        description: p.description ?? "",
        input_formats: p.input_formats ?? [],
        output_formats: p.output_formats ?? [],
        required_params: p.required_params ?? [],
        optional_params: p.optional_params ?? {},
        hardware_requirements: p.hardware_requirements ?? [],
        typical_compression: p.typical_compression,
        gotchas: p.gotchas ?? [],
      },
    ]),
  );
}

/** Hot-reload the parameter schemas from a freshly-fetched passes.json object. */
export function reloadPassSchemas(data: PassesJson): void {
  PARAM_SCHEMAS = buildParamSchemas(data);
}

/** Get KB metadata (version, last_updated, pass count) without reloading. */
export function getKbMetadata(): { version: string; lastUpdated: string; passCount: number } {
  return {
    version: (kb as { version?: string }).version ?? "unknown",
    lastUpdated: (kb as { last_updated?: string }).last_updated ?? "unknown",
    passCount: PARAM_SCHEMAS.size,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Get the unified schema for a pass type, merging catalog + knowledge-base data. */
export function getPassSchema(name: string): UnifiedPassSchema | undefined {
  const catalogEntry = getPassCatalogEntry(name);
  const paramSchema = PARAM_SCHEMAS.get(name);

  if (!catalogEntry && !paramSchema) return undefined;

  return {
    name,
    category: catalogEntry?.category ?? "onnx",
    description: paramSchema?.description ?? catalogEntry?.description ?? "",
    inputs: catalogEntry?.inputs ?? paramSchema?.input_formats ?? [],
    outputs: catalogEntry?.outputs ?? paramSchema?.output_formats ?? [],
    params: paramSchema?.optional_params ?? {},
    requiredParams: paramSchema?.required_params ?? [],
    hardwareRequirements: paramSchema?.hardware_requirements ?? [],
    gotchas: paramSchema?.gotchas ?? [],
  };
}

/** Check if a pass type name is known to either the catalog or the knowledge base. */
export function isKnownPass(name: string): boolean {
  return isKnownPassName(name) || PARAM_SCHEMAS.has(name);
}

// ─── Per-pass config validation ────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkParamType(value: unknown, type: ParamType): boolean {
  switch (type) {
    case "str":
      return typeof value === "string";
    case "int":
      return typeof value === "number" && Number.isInteger(value);
    case "float":
      return typeof value === "number";
    case "bool":
      return typeof value === "boolean";
    case "dict":
      return isObject(value);
    case "list[str]":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "list[int]":
      return Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isInteger(v));
    case "list[float]":
      return Array.isArray(value) && value.every((v) => typeof v === "number");
    default:
      return true;
  }
}

/**
 * Validate a pass config object against its parameter schema.
 * Returns a list of error strings (empty if valid).
 */
export function validatePassConfig(passType: string, config: unknown): string[] {
  const errors: string[] = [];

  if (config === undefined || config === null) {
    return errors;
  }

  if (!isObject(config)) {
    errors.push(`config must be an object`);
    return errors;
  }

  const schema = getPassSchema(passType);
  if (!schema) {
    return errors;
  }

  // Check required params
  for (const reqParam of schema.requiredParams) {
    if (!(reqParam in config)) {
      errors.push(`missing required parameter "${reqParam}"`);
    }
  }

  // Check each present param against its schema
  for (const [key, value] of Object.entries(config)) {
    const paramSchema = schema.params[key];
    if (!paramSchema) {
      continue;
    }

    // Type check
    if (!checkParamType(value, paramSchema.type)) {
      errors.push(`parameter "${key}" must be of type ${paramSchema.type}, got ${typeof value}`);
      continue;
    }

    // Enum check
    if (paramSchema.enum && typeof value === "string" && !paramSchema.enum.includes(value)) {
      errors.push(`parameter "${key}" must be one of [${paramSchema.enum.join(", ")}], got "${value}"`);
    }
  }

  return errors;
}

// ─── Full recipe schema validation ─────────────────────────────────────────────

/**
 * Validate an Olive recipe's structure and per-pass configs.
 *
 * This is the unified entry point that supersedes `validateOliveRecipeStructure`
 * from `oliveRecipeSchema.ts`. It performs:
 * 1. Top-level structural checks (input_model, systems, passes, engine)
 * 2. Pass type validation against the unified catalog
 * 3. Per-pass config validation against parameter schemas
 * 4. System/accelerator reference validation
 */
export function validateRecipeSchema(recipe: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!isObject(recipe)) {
    return { valid: false, errors: ["recipe must be an object"] };
  }

  // ── input_model ──────────────────────────────────────────────
  const inputModel = recipe.input_model;
  if (!isObject(inputModel)) {
    errors.push("input_model must be an object");
    return { valid: false, errors };
  }
  if (typeof inputModel.type !== "string" || inputModel.type.trim().length === 0) {
    errors.push("input_model.type must be a non-empty string");
  }
  if (!isObject(inputModel.config)) {
    errors.push("input_model.config must be an object");
  }

  // ── systems ──────────────────────────────────────────────────
  if (!isObject(recipe.systems)) {
    errors.push("systems must be an object");
    return { valid: false, errors };
  }

  // ── passes ───────────────────────────────────────────────────
  if (!isObject(recipe.passes)) {
    errors.push("passes must be an object");
    return { valid: false, errors };
  }

  for (const [passName, passValue] of Object.entries(recipe.passes)) {
    if (!isObject(passValue)) {
      errors.push(`passes.${passName} must be an object`);
      continue;
    }
    if (typeof passValue.type !== "string" || passValue.type.trim().length === 0) {
      errors.push(`passes.${passName}.type must be a non-empty string`);
      continue;
    }

    // Validate pass type against unified catalog
    if (!isKnownPass(passValue.type)) {
      errors.push(
        `passes.${passName}.type "${passValue.type}" is not a known Olive 0.12.1 pass. ` +
          `Run \`olive run-pass --list-passes\` to see the full list.`,
      );
    }

    // Validate pass config against parameter schema
    if (passValue.config !== undefined && !isObject(passValue.config)) {
      errors.push(`passes.${passName}.config must be an object when present`);
    } else if (isObject(passValue.config)) {
      const configErrors = validatePassConfig(passValue.type, passValue.config);
      for (const err of configErrors) {
        errors.push(`passes.${passName}: ${err}`);
      }
    }
  }

  // ── engine ───────────────────────────────────────────────────
  if (!isObject(recipe.engine)) {
    errors.push("engine must be an object");
    return { valid: false, errors };
  }
  if (typeof recipe.engine.host !== "string" || recipe.engine.host.trim().length === 0) {
    errors.push("engine.host must be a non-empty string");
  }
  if (typeof recipe.engine.target !== "string" || recipe.engine.target.trim().length === 0) {
    errors.push("engine.target must be a non-empty string");
  }

  // ── system references ────────────────────────────────────────
  if (typeof recipe.engine.host === "string") {
    validateSystemRef(recipe.systems, recipe.engine.host, "host", errors);
  }
  if (typeof recipe.engine.target === "string") {
    validateSystemRef(recipe.systems, recipe.engine.target, "target", errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateSystemRef(
  systems: Record<string, unknown>,
  ref: string,
  label: string,
  errors: string[],
): void {
  const system = systems[ref];
  if (!isObject(system)) {
    errors.push(`engine.${label} references "${ref}" which is not a valid system key`);
    return;
  }
  if (!isObject(system.config)) {
    errors.push(`systems.${ref}.config must be an object`);
    return;
  }
  const accelerators = (system.config as Record<string, unknown>).accelerators;
  if (!Array.isArray(accelerators) || accelerators.length === 0) {
    errors.push(`systems.${ref}.config.accelerators must be a non-empty array`);
    return;
  }
  for (let i = 0; i < accelerators.length; i++) {
    const acc = accelerators[i];
    if (!isObject(acc)) {
      errors.push(`systems.${ref}.config.accelerators[${i}] must be an object`);
      continue;
    }
    if (typeof acc.device !== "string" || acc.device.trim().length === 0) {
      errors.push(`systems.${ref}.config.accelerators[${i}].device must be a non-empty string`);
    }
    if (!Array.isArray(acc.execution_providers) || acc.execution_providers.length === 0) {
      errors.push(`systems.${ref}.config.accelerators[${i}].execution_providers must be a non-empty array`);
    }
  }
}
