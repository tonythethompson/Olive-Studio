/**
 * Typed pass accessors — per-domain narrowing functions over the flat UIState.passes bag.
 *
 * These provide compile-time safety when reading pass fields without changing
 * the store/API shape. The MCP tools remain the agent's abstraction layer;
 * these accessors are for internal TypeScript DX.
 */
import type { UIState } from "@/types";

type Passes = UIState["passes"];

// ─── Conversion ─────────────────────────────────────────────────────

export interface ConversionConfig {
  enabled: true;
  sourceFormat: Passes["conversionSourceFormat"];
  targetFormat: Passes["conversionFormat"];
  opset: number;
  ioTypes: string;
}

/** Typed accessor for conversion pass fields. Returns null when conversion is disabled. */
export function getConversionConfig(passes: Passes): ConversionConfig | null {
  if (!passes.conversion) return null;
  return {
    enabled: true,
    sourceFormat: passes.conversionSourceFormat,
    targetFormat: passes.conversionFormat,
    opset: passes.conversionOpset,
    ioTypes: passes.conversionInputTargetTypes,
  };
}

// ─── Quantization ───────────────────────────────────────────────────

interface QuantBaseConfig {
  enabled: true;
  precision: Passes["quantPrecision"];
  preset: string;
}

export interface PtqQuantConfig extends QuantBaseConfig {
  method: "ptq";
}

export interface AwqQuantConfig extends QuantBaseConfig {
  method: "awq";
  groupSize: number;
  dampPercent: number;
  sym: boolean;
}

export interface GptqQuantConfig extends QuantBaseConfig {
  method: "gptq";
  blockSize: number;
  groupSize: number;
  descAct: boolean;
}

export interface QatQuantConfig extends QuantBaseConfig {
  method: "qat";
  qatPrecision: "int4" | "int8";
  calibrateMethod: "minmax" | "percentile" | "entropy";
  calibrateSteps: number;
}

export interface HqqQuantConfig extends QuantBaseConfig {
  method: "hqq";
}

export interface RtnQuantConfig extends QuantBaseConfig {
  method: "rtn";
}

export interface SpinQuantConfig extends QuantBaseConfig {
  method: "spinquant";
}

export interface QuaRotQuantConfig extends QuantBaseConfig {
  method: "quarot";
}

export type QuantizationConfig =
  | PtqQuantConfig
  | AwqQuantConfig
  | GptqQuantConfig
  | QatQuantConfig
  | HqqQuantConfig
  | RtnQuantConfig
  | SpinQuantConfig
  | QuaRotQuantConfig;

/** Typed accessor for quantization pass fields. Discriminated by `method`. Returns null when disabled. */
export function getQuantConfig(passes: Passes): QuantizationConfig | null {
  if (!passes.quantization) return null;
  const base: QuantBaseConfig = {
    enabled: true,
    precision: passes.quantPrecision,
    preset: passes.quantPreset,
  };
  switch (passes.quantMethod) {
    case "awq":
      return { ...base, method: "awq", groupSize: passes.awqGroupSize, dampPercent: passes.awqDampPercent, sym: passes.awqSym };
    case "gptq":
      return { ...base, method: "gptq", blockSize: passes.gptqBlockSize, groupSize: passes.gptqGroupSize, descAct: passes.gptqDescAct };
    case "qat":
      return { ...base, method: "qat", qatPrecision: passes.qatQuantPrecision, calibrateMethod: passes.qatCalibrateMethod, calibrateSteps: passes.qatCalibrateSteps };
    case "hqq":
      return { ...base, method: "hqq" };
    case "rtn":
      return { ...base, method: "rtn" };
    case "spinquant":
      return { ...base, method: "spinquant" };
    case "quarot":
      return { ...base, method: "quarot" };
    default:
      return { ...base, method: "ptq" };
  }
}

// ─── Pruning ────────────────────────────────────────────────────────

export interface PruningConfig {
  enabled: true;
  sparsity: number;
  type: Passes["pruningType"];
  method: Passes["pruningMethod"];
  criteria: Passes["pruningCriteria"];
}

/** Typed accessor for pruning pass fields. Returns null when pruning is disabled. */
export function getPruningConfig(passes: Passes): PruningConfig | null {
  if (!passes.pruning) return null;
  return {
    enabled: true,
    sparsity: passes.pruningSparsity,
    type: passes.pruningType,
    method: passes.pruningMethod,
    criteria: passes.pruningCriteria,
  };
}

// ─── PEFT ───────────────────────────────────────────────────────────

export interface PeftConfig {
  enabled: true;
  method: Passes["peftMethod"];
  diffusionLora: boolean;
}

/** Typed accessor for PEFT pass fields. Returns null when PEFT is disabled. */
export function getPeftConfig(passes: Passes): PeftConfig | null {
  if (!passes.peft) return null;
  return {
    enabled: true,
    method: passes.peftMethod,
    diffusionLora: passes.diffusionLora,
  };
}

// ─── Simple toggles ─────────────────────────────────────────────────

/** Whether model splitting is active. */
export function isSplittingEnabled(passes: Passes): boolean {
  return passes.splitting;
}

/** Whether ONNX graph transforms are active. */
export function isOnnxTransformsEnabled(passes: Passes): boolean {
  return passes.onnxTransforms;
}
