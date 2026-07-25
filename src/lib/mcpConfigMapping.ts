import type { UIState } from "@/types";

/**
 * Map MCP diagnostic `updated_config` keys to UIState patches.
 *
 * Both ExecutionWorkspace and BatchProcessingPanel used to duplicate this
 * mapping logic. Extracted here so both consumers share a single source of
 * truth for how MCP config keys translate to Olive Studio UIState fields.
 *
 * @param config  The `updated_config` object from an MCP diagnostic response.
 * @param currentPasses  The current `state.passes` to merge into.
 * @returns  A partial UIState with the mapped patches, plus any log messages
 *           for config keys that have no direct UIState equivalent.
 */
export function mapMcpConfigToUiState(
  config: Record<string, unknown>,
  currentPasses: UIState["passes"],
): { patches: Partial<UIState>; logs: string[] } {
  const patches: Partial<UIState> = {};
  const logs: string[] = [];

  // use_external_data_format → no direct UIState equivalent, log it
  if ("use_external_data_format" in config) {
    logs.push(`[MCP FIX] Applied: use_external_data_format = ${config.use_external_data_format}`);
  }

  // precision → quantPrecision
  if ("precision" in config && typeof config.precision === "string") {
    const precision = config.precision;
    if (precision === "int4" || precision === "int8" || precision === "fp16") {
      patches.passes = { ...currentPasses, quantPrecision: precision };
    }
  }

  // quant_mode → quantMethod (static → ptq)
  if ("quant_mode" in config && typeof config.quant_mode === "string") {
    if (config.quant_mode === "static") {
      patches.passes = {
        ...(patches.passes ?? currentPasses),
        quantMethod: "ptq",
      };
    }
  }

  // sym → awqSym
  if ("sym" in config && typeof config.sym === "boolean") {
    patches.passes = {
      ...(patches.passes ?? currentPasses),
      awqSym: config.sym,
    };
  }

  return { patches, logs };
}
