/**
 * MCP parameter validation.
 *
 * Fetches parameter metadata from the MCP server's get_pass_parameters tool
 * and validates the current recipe config against MCP-defined constraints:
 * required_params, valid_range, and interactions.
 */

import { buildOliveRecipe } from "@/lib/oliveRecipeBuilder";
import type { UIState } from "@/types";

export interface McpParamWarning {
  id: string;
  severity: "warning" | "critical";
  title: string;
  description: string;
  passName: string;
}

interface McpParamDoc {
  description?: string;
  type?: string;
  default?: unknown;
  valid_range?: string;
  interactions?: string;
}

interface McpPassParamsResponse {
  pass_name?: string;
  description?: string;
  required_params?: string[];
  parameters?: Record<string, McpParamDoc>;
  gotchas?: string[];
  error?: string;
}

/**
 * Parse a valid_range string like "1-128", ">0", "0.0-1.0", "int4|int8|fp16"
 * and check if a value is within it.
 */
function isValueInRange(value: unknown, range: string): boolean {
  if (value === undefined || value === null) return true; // not set, skip

  const trimmed = range.trim();

  // Enum: "int4|int8|fp16" or "ptq|awq|qat"
  if (trimmed.includes("|")) {
    const options = trimmed.split("|").map((s) => s.trim());
    return options.includes(String(value));
  }

  // Greater than: ">0"
  const gtMatch = trimmed.match(/^>\s*(-?\d+(?:\.\d+)?)$/);
  if (gtMatch) {
    const num = Number(value);
    const min = Number(gtMatch[1]);
    return !isNaN(num) && num > min;
  }

  // Greater than or equal: ">=0"
  const gteMatch = trimmed.match(/^>=\s*(-?\d+(?:\.\d+)?)$/);
  if (gteMatch) {
    const num = Number(value);
    const min = Number(gteMatch[1]);
    return !isNaN(num) && num >= min;
  }

  // Range: "1-128" or "0.0-1.0"
  const rangeMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const num = Number(value);
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    return !isNaN(num) && num >= min && num <= max;
  }

  // Unknown format — pass validation
  return true;
}

/**
 * Fetch MCP parameter metadata for a pass type.
 * Caches results per session to avoid redundant fetches.
 */
const paramCache = new Map<string, McpPassParamsResponse | null>();

export async function fetchMcpPassParams(passTypeName: string): Promise<McpPassParamsResponse | null> {
  if (paramCache.has(passTypeName)) {
    return paramCache.get(passTypeName) ?? null;
  }

  try {
    const res = await fetch("/api/mcp/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "get_pass_parameters",
        args: { pass_name: passTypeName },
      }),
    });

    if (!res.ok) {
      paramCache.set(passTypeName, null);
      return null;
    }

    const data: McpPassParamsResponse = await res.json();
    if (data.error) {
      paramCache.set(passTypeName, null);
      return null;
    }

    paramCache.set(passTypeName, data);
    return data;
  } catch {
    paramCache.set(passTypeName, null);
    return null;
  }
}

/**
 * Validate a single pass's config against MCP parameter metadata.
 */
function validateSinglePass(
  passName: string,
  passTypeName: string,
  config: Record<string, unknown>,
  meta: McpPassParamsResponse,
): McpParamWarning[] {
  const warnings: McpParamWarning[] = [];
  const params = meta.parameters ?? {};
  const required = meta.required_params ?? [];

  // Check required params
  for (const req of required) {
    if (!(req in config) && config[req] === undefined) {
      const paramDoc = params[req];
      warnings.push({
        id: `mcp-required-${passName}-${req}`,
        severity: "critical",
        title: `${passTypeName}: missing required param`,
        description: `'${req}' is required but not set. ${paramDoc?.description ? paramDoc.description : ""}`,
        passName,
      });
    }
  }

  // Check valid_range for each configured param
  for (const [key, value] of Object.entries(config)) {
    const doc = params[key];
    if (!doc?.valid_range) continue;

    // Skip non-primitive values (objects, arrays)
    if (typeof value === "object" && value !== null) continue;

    if (!isValueInRange(value, doc.valid_range)) {
      warnings.push({
        id: `mcp-range-${passName}-${key}`,
        severity: "warning",
        title: `${passTypeName}: '${key}' out of range`,
        description: `Value ${JSON.stringify(value)} is outside valid range: ${doc.valid_range}. ${
          doc.description ?? ""
        }`,
        passName,
      });
    }
  }

  // Surface interaction warnings
  for (const [key, value] of Object.entries(config)) {
    const doc = params[key];
    if (!doc?.interactions || value === undefined || value === null) continue;

    // Only surface if the param is set to a non-default value
    const isDefault = doc.default !== undefined && JSON.stringify(value) === JSON.stringify(doc.default);
    if (isDefault) continue;

    warnings.push({
      id: `mcp-interaction-${passName}-${key}`,
      severity: "warning",
      title: `${passTypeName}: '${key}' interaction`,
      description: doc.interactions,
      passName,
    });
  }

  return warnings;
}

/**
 * Fetch MCP parameter metadata for all active passes and validate their configs.
 * Returns a flat list of warnings.
 */
export async function validateMcpParams(
  state: UIState,
  activePassNames: string[],
): Promise<McpParamWarning[]> {
  const recipe = buildOliveRecipe(state);
  const recipePasses = (recipe.passes ?? {}) as Record<
    string,
    { type: string; config: Record<string, unknown> }
  >;

  const allWarnings: McpParamWarning[] = [];

  // Collect unique pass types to fetch
  const passTypeFetches = new Map<string, string[]>(); // passTypeName -> passNames[]
  for (const passName of activePassNames) {
    const passConfig = recipePasses[passName];
    const passTypeName = passConfig?.type ?? passName;
    if (!passTypeFetches.has(passTypeName)) {
      passTypeFetches.set(passTypeName, []);
    }
    passTypeFetches.get(passTypeName)!.push(passName);
  }

  // Fetch metadata for each unique pass type (deduped)
  const fetches = Array.from(passTypeFetches.keys()).map(async (typeName) => {
    const meta = await fetchMcpPassParams(typeName);
    return { typeName, meta };
  });

  const results = await Promise.allSettled(fetches);

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { typeName, meta } = result.value;
    if (!meta) continue;

    const passNames = passTypeFetches.get(typeName) ?? [];
    for (const passName of passNames) {
      const passConfig = recipePasses[passName];
      if (!passConfig) continue;
      allWarnings.push(...validateSinglePass(passName, typeName, passConfig.config, meta));
    }
  }

  return allWarnings;
}
