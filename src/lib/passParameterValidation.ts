/**
 * Hardware-specific pass parameter validation.
 *
 * Validates that the parameters of active passes are compatible with the
 * selected hardware execution provider. Returns warnings when parameters
 * are suboptimal or incorrect for the target hardware.
 */

import type { UIState, IHVProvider } from "@/types";

export interface ParameterWarning {
  id: string;
  severity: "warning" | "error";
  title: string;
  description: string;
  passName: string;
}

interface ParamRule {
  /** Human-readable check name */
  name: string;
  /** Check function: returns null if ok, warning message if not */
  check: (passes: UIState["passes"]) => string | null;
}

/**
 * Map IHV providers to human-readable hardware names for display.
 */
function hardwareLabel(provider: IHVProvider): string {
  switch (provider) {
    case "QNNExecutionProvider":
      return "Qualcomm QNN";
    case "OpenVINOExecutionProvider":
      return "Intel OpenVINO";
    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
      return "NVIDIA GPU";
    case "CPUExecutionProvider":
      return "CPU";
    default:
      return provider;
  }
}

/**
 * Build parameter validation rules for a given hardware provider.
 * Each rule checks a specific parameter constraint.
 */
function getRulesForProvider(provider: IHVProvider): Record<string, ParamRule[]> {
  const rules: Record<string, ParamRule[]> = {};

  if (provider === "QNNExecutionProvider") {
    rules["QNNQuantization"] = [
      {
        name: "QNN INT8 requires per-channel symmetric quantization",
        check: (passes) => {
          if (passes.quantPrecision === "int8") {
            if (passes.quantMethod === "awq" && !passes.awqSym) {
              return "QNN with AWQ requires symmetric quantization (awqSym=true) for INT8. Non-symmetric quantization may produce incorrect results.";
            }
            if (passes.quantMethod !== "awq") {
              return "QNN INT8 quantization requires per-channel symmetric quantization. AWQ with awqSym=true is the recommended path.";
            }
          }
          return null;
        },
      },
      {
        name: "QNN prefers INT4 over INT8 for LLMs",
        check: (passes) => {
          if (passes.quantPrecision === "int8" && passes.quantMethod === "awq") {
            return "QNN with AWQ quantization works significantly better with INT4 weights for large models (15GB+). Current INT8 may cause excessive accuracy drops (5-10%).";
          }
          return null;
        },
      },
    ];
    rules["OnnxQuantization"] = [
      {
        name: "OnnxQuantization on QNN needs per-channel symmetric",
        check: (passes) => {
          if (passes.quantPrecision === "int8") {
            if (passes.quantMethod === "awq" && !passes.awqSym) {
              return "OnnxQuantization with AWQ INT8 on QNN requires per_channel=true and symmetric quantization (awqSym=true) for accurate results.";
            }
            if (passes.quantMethod === "ptq") {
              return "OnnxQuantization PTQ INT8 on QNN requires per-channel symmetric quantization. AWQ with awqSym=true is the recommended path for Qualcomm hardware.";
            }
          }
          return null;
        },
      },
    ];
  }

  if (provider === "OpenVINOExecutionProvider") {
    rules["OnnxQuantization"] = [
      {
        name: "OpenVINO prefers static quantization",
        check: (passes) => {
          // Only warn if using OnnxQuantization (dynamic) instead of OnnxStaticQuantization
          // The activePassNames check happens outside; this rule fires for OnnxQuantization specifically
          if (passes.quantPrecision === "int8") {
            return "OpenVINO performs best with INT8 static quantization (OnnxStaticQuantization) rather than OnnxQuantization. Consider switching to the static variant for better accuracy.";
          }
          return null;
        },
      },
    ];
  }

  if (
    provider === "CUDAExecutionProvider" ||
    provider === "TensorrtExecutionProvider" ||
    provider === "NvTensorRTRTXExecutionProvider"
  ) {
    rules["OnnxQuantization"] = [
      {
        name: "NVIDIA prefers AWQ INT4 over PTQ INT8 for LLMs",
        check: (passes) => {
          if (passes.quantPrecision === "int8" && passes.quantMethod === "ptq") {
            return "NVIDIA GPU works best with AWQ INT4 quantization for LLMs (typically <2% perplexity drop). PTQ INT8 can drop 10-15% perplexity on large models.";
          }
          return null;
        },
      },
    ];
  }

  if (provider === "CPUExecutionProvider") {
    rules["OnnxQuantization"] = [
      {
        name: "CPU quantization is slower than GPU",
        check: (passes) => {
          if (passes.quantPrecision === "int4") {
            return "INT4 quantization on CPU may have limited runtime support. INT8 is more widely supported on CPU execution providers.";
          }
          return null;
        },
      },
    ];
  }

  return rules;
}

/**
 * Validate active pass parameters against the selected hardware.
 * Returns warnings for parameter incompatibilities.
 */
export function validatePassParameters(state: UIState, activePassNames: string[]): ParameterWarning[] {
  const warnings: ParameterWarning[] = [];
  const provider = state.ihvProvider;
  const rules = getRulesForProvider(provider);

  // Check each active pass against the rules
  for (const passName of activePassNames) {
    const passRules = rules[passName];
    if (!passRules) continue;

    for (const rule of passRules) {
      const message = rule.check(state.passes);
      if (message) {
        warnings.push({
          id: `param-${passName}-${rule.name}`,
          severity: "warning",
          title: `${hardwareLabel(provider)}: ${rule.name}`,
          description: message,
          passName,
        });
      }
    }
  }

  return warnings;
}
