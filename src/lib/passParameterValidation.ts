/**
 * Hardware-specific pass parameter validation.
 *
 * Validates that the parameters of active passes are compatible with the
 * selected hardware execution provider. Returns warnings when parameters
 * are suboptimal or incorrect for the target hardware.
 */

import { buildOliveRecipe } from "@/lib/oliveRecipeBuilder";
import type { UIState, IHVProvider, OliveRecipe } from "@/types";

export interface ParameterWarning {
  id: string;
  severity: "warning" | "error";
  title: string;
  description: string;
  passName: string;
  actionLabel?: string;
  autofix?: { passes?: Partial<UIState["passes"]> };
}

interface ParamRule {
  /** Human-readable check name */
  name: string;
  /** Check function: returns null if ok, warning message if not */
  check: (passes: UIState["passes"]) => string | null;
  /** Optional state patch applied when the user clicks the autofix button */
  autofix?: { passes?: Partial<UIState["passes"]> };
  /** Button label for the autofix action */
  actionLabel?: string;
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
      return "NVIDIA CUDA";
    case "TensorrtExecutionProvider":
      return "NVIDIA TensorRT";
    case "NvTensorRTRTXExecutionProvider":
      return "NVIDIA TensorRT RTX";
    case "ROCMExecutionProvider":
      return "AMD ROCm";
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
        autofix: { passes: { quantMethod: "awq", awqSym: true } },
        actionLabel: "Enable AWQ symmetric",
      },
      {
        name: "QNN prefers INT4 over INT8 for LLMs",
        check: (passes) => {
          if (passes.quantPrecision === "int8" && passes.quantMethod === "awq") {
            return "QNN with AWQ quantization works significantly better with INT4 weights for large models (15GB+). Current INT8 may cause excessive accuracy drops (5-10%).";
          }
          return null;
        },
        autofix: { passes: { quantPrecision: "int4" } },
        actionLabel: "Switch to INT4",
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
        autofix: { passes: { quantMethod: "awq", awqSym: true } },
        actionLabel: "Enable AWQ symmetric",
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

  if (provider === "CUDAExecutionProvider") {
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

  if (provider === "TensorrtExecutionProvider") {
    rules["OnnxQuantization"] = [
      {
        name: "TensorRT INT8 requires QDQ format",
        check: (passes) => {
          if (passes.quantPrecision === "int8" && passes.quantMethod === "ptq") {
            return "TensorRT INT8 quantization requires QDQ (QuantizeDequantize) nodes in the ONNX graph. PTQ INT8 does not generate QDQ — use AWQ instead, which produces the correct format for TensorRT.";
          }
          return null;
        },
      },
      {
        name: "TensorRT prefers AWQ INT4 for LLMs",
        check: (passes) => {
          if (passes.quantPrecision === "int8" && passes.quantMethod === "awq") {
            return "TensorRT works best with AWQ INT4 for LLMs. INT4 provides better memory efficiency and faster inference with minimal accuracy impact.";
          }
          return null;
        },
      },
      {
        name: "TensorRT engine builds are slow",
        check: (passes) => {
          if (passes.quantization && passes.quantMethod !== "awq") {
            return "TensorRT engine optimization is time-intensive (minutes to hours). AWQ pre-quantized models skip the TensorRT calibration step, significantly reducing build time.";
          }
          return null;
        },
      },
    ];
  }

  if (provider === "NvTensorRTRTXExecutionProvider") {
    rules["OnnxQuantization"] = [
      {
        name: "TensorRT RTX prefers INT4 AWQ",
        check: (passes) => {
          if (passes.quantPrecision === "int8") {
            return "TensorRT RTX (consumer GeForce) works best with AWQ INT4 quantization. INT4 reduces VRAM usage on consumer GPUs and provides faster inference with minimal accuracy impact.";
          }
          return null;
        },
        autofix: { passes: { quantPrecision: "int4", quantMethod: "awq" } },
        actionLabel: "Switch to AWQ INT4",
      },
      {
        name: "TensorRT RTX INT8 requires QDQ format",
        check: (passes) => {
          if (passes.quantPrecision === "int8" && passes.quantMethod === "ptq") {
            return "TensorRT RTX INT8 requires QDQ format. PTQ INT8 does not generate QDQ nodes — use AWQ instead for correct INT8 quantization on TensorRT RTX.";
          }
          return null;
        },
        autofix: { passes: { quantMethod: "awq" } },
        actionLabel: "Switch to AWQ",
      },
    ];
  }

  if (provider === "ROCMExecutionProvider") {
    rules["OnnxQuantization"] = [
      {
        name: "AWQ has limited ROCm support",
        check: (passes) => {
          if (passes.quantMethod === "awq") {
            return "AWQ quantization has limited support on AMD ROCm GPUs. GPTQ is the recommended quantization method for AMD hardware with better ROCm compatibility and performance.";
          }
          return null;
        },
        autofix: { passes: { quantMethod: "gptq" } },
        actionLabel: "Switch to GPTQ",
      },
      {
        name: "ROCm prefers GPTQ INT4 for LLMs",
        check: (passes) => {
          if (passes.quantPrecision === "int8") {
            return "AMD ROCm GPUs work best with GPTQ INT4 quantization for LLMs. INT4 reduces VRAM usage and GPTQ provides better ROCm compatibility and faster inference on AMD GPUs than PTQ INT8.";
          }
          return null;
        },
        autofix: { passes: { quantPrecision: "int4", quantMethod: "gptq" } },
        actionLabel: "Switch to GPTQ INT4",
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
 * Map the actual Olive pass type produced by the recipe builder to the canonical
 * rule key used by getRulesForProvider. This keeps the UI validation in sync
 * with the generated Olive recipe rather than generic step IDs.
 */
function getRuleKey(passType: string): string | null {
  // Qualcomm QNN uses its own pass type and rules
  if (passType === "QNNQuantization") return "QNNQuantization";

  // OpenVINO's built-in quantization passes are already static/optimized; no generic rules
  if (passType === "OpenVINOQuantization" || passType === "OpenVINOWeightCompression")
    return "OpenVINOQuantization";

  // All other PyTorch and ONNX quantizers map to the generic OnnxQuantization rules
  // (the rule checks use quantMethod/quantPrecision to avoid false positives).
  if (
    passType === "OnnxQuantization" ||
    passType === "AutoAWQQuantizer" ||
    passType === "GptqQuantizer" ||
    passType === "QATQuantizer" ||
    passType === "OnnxHqqQuantization" ||
    passType === "OnnxBlockWiseRtnQuantization" ||
    passType === "SpinQuant" ||
    passType === "QuaRot" ||
    passType === "Nvfp4Quantizer"
  ) {
    return "OnnxQuantization";
  }

  return null;
}

/**
 * Validate active pass parameters against the selected hardware.
 * Returns warnings for parameter incompatibilities.
 */
export function validatePassParameters(state: UIState, activePassNames: string[]): ParameterWarning[] {
  const warnings: ParameterWarning[] = [];
  const provider = state.ihvProvider;
  const rules = getRulesForProvider(provider);

  // Build the generated recipe to find the actual Olive pass types for active steps
  const recipe = buildOliveRecipe(state) as unknown as OliveRecipe;
  const recipePasses = recipe.passes ?? {};

  // Check each active pass against the rules
  for (const passName of activePassNames) {
    const passConfig = recipePasses[passName];
    const passType = passConfig ? passConfig.type : passName;
    const ruleKey = getRuleKey(passType);
    if (!ruleKey) continue;

    const passRules = rules[ruleKey];
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
          autofix: rule.autofix,
          actionLabel: rule.actionLabel,
        });
      }
    }
  }

  return warnings;
}
