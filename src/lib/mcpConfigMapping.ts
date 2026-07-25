import type { UIState } from "@/types";

/**
 * All recognized MCP config keys that mapMcpConfigToUiState handles.
 * Adding a new key here forces a compile-time check that the mapping logic
 * covers it — typos like `precisionn` will fail at build time.
 */
export type McpConfigKey =
  | "use_external_data_format"
  | "precision"
  | "quant_mode"
  | "sym"
  | "block_size"
  | "group_size"
  | "damp_percent"
  | "desc_act"
  | "alpha";

type McpConfig = Partial<Record<McpConfigKey, unknown>>;

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
  config: McpConfig,
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

  // block_size → gptqBlockSize or awqGroupSize (AWQ uses group_size for block)
  if ("block_size" in config && typeof config.block_size === "number") {
    if (config.block_size > 0 && Number.isInteger(config.block_size)) {
      patches.passes = {
        ...(patches.passes ?? currentPasses),
        gptqBlockSize: config.block_size,
      };
    }
  }

  // group_size → gptqGroupSize or awqGroupSize (based on active quant method)
  if ("group_size" in config && typeof config.group_size === "number") {
    if (config.group_size > 0 && Number.isInteger(config.group_size)) {
      const method = (patches.passes ?? currentPasses).quantMethod;
      if (method === "gptq") {
        patches.passes = {
          ...(patches.passes ?? currentPasses),
          gptqGroupSize: config.group_size,
        };
      } else if (method === "awq") {
        patches.passes = {
          ...(patches.passes ?? currentPasses),
          awqGroupSize: config.group_size,
        };
      } else {
        // Default: set both so the active method picks up the value
        patches.passes = {
          ...(patches.passes ?? currentPasses),
          gptqGroupSize: config.group_size,
          awqGroupSize: config.group_size,
        };
      }
    }
  }

  // damp_percent → awqDampPercent
  if ("damp_percent" in config && typeof config.damp_percent === "number") {
    if (config.damp_percent >= 0 && config.damp_percent <= 1) {
      patches.passes = {
        ...(patches.passes ?? currentPasses),
        awqDampPercent: config.damp_percent,
      };
    }
  }

  // desc_act → gptqDescAct
  if ("desc_act" in config && typeof config.desc_act === "boolean") {
    patches.passes = {
      ...(patches.passes ?? currentPasses),
      gptqDescAct: config.desc_act,
    };
  }

  // alpha → no direct UIState equivalent (LoRA-specific), log it
  if ("alpha" in config) {
    logs.push(
      `[MCP FIX] Note: alpha = ${JSON.stringify(config.alpha)} (LoRA scaling factor, no UIState mapping)`,
    );
  }

  return { patches, logs };
}
