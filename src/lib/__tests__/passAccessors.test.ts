import { describe, it, expect } from "vitest";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import {
  getConversionConfig,
  getQuantConfig,
  getPruningConfig,
  getPeftConfig,
  isSplittingEnabled,
  isOnnxTransformsEnabled,
} from "@/lib/passAccessors";
import type { UIState } from "@/types";

type Passes = UIState["passes"];

describe("passAccessors", () => {
  describe("getConversionConfig", () => {
    it("returns null when conversion is disabled", () => {
      expect(getConversionConfig({ ...DEFAULT_PASSES, conversion: false })).toBeNull();
    });

    it("returns typed config when conversion is enabled", () => {
      const config = getConversionConfig(DEFAULT_PASSES);
      expect(config).toEqual({
        enabled: true,
        sourceFormat: "pytorch",
        targetFormat: "onnx",
        opset: 20,
        ioTypes: "float32",
      });
    });

    it("reflects non-default values", () => {
      const passes: Passes = {
        ...DEFAULT_PASSES,
        conversion: true,
        conversionFormat: "openvino",
        conversionSourceFormat: "tensorflow",
        conversionOpset: 17,
        conversionInputTargetTypes: "float16",
      };
      const config = getConversionConfig(passes)!;
      expect(config.targetFormat).toBe("openvino");
      expect(config.sourceFormat).toBe("tensorflow");
      expect(config.opset).toBe(17);
      expect(config.ioTypes).toBe("float16");
    });
  });

  describe("getQuantConfig", () => {
    it("returns null when quantization is disabled", () => {
      expect(getQuantConfig({ ...DEFAULT_PASSES, quantization: false })).toBeNull();
    });

    it("returns PtqQuantConfig for ptq method", () => {
      const config = getQuantConfig({ ...DEFAULT_PASSES, quantization: true, quantMethod: "ptq" });
      expect(config).toMatchObject({ method: "ptq", enabled: true, precision: "int8" });
    });

    it("returns AwqQuantConfig with method-specific fields", () => {
      const passes: Passes = {
        ...DEFAULT_PASSES,
        quantization: true,
        quantMethod: "awq",
        quantPrecision: "int4",
        awqGroupSize: 64,
        awqDampPercent: 0.005,
        awqSym: false,
      };
      const config = getQuantConfig(passes)!;
      expect(config.method).toBe("awq");
      if (config.method === "awq") {
        expect(config.groupSize).toBe(64);
        expect(config.dampPercent).toBe(0.005);
        expect(config.sym).toBe(false);
      }
    });

    it("returns GptqQuantConfig with method-specific fields", () => {
      const passes: Passes = {
        ...DEFAULT_PASSES,
        quantization: true,
        quantMethod: "gptq",
        gptqBlockSize: 64,
        gptqGroupSize: 32,
        gptqDescAct: true,
      };
      const config = getQuantConfig(passes)!;
      expect(config.method).toBe("gptq");
      if (config.method === "gptq") {
        expect(config.blockSize).toBe(64);
        expect(config.groupSize).toBe(32);
        expect(config.descAct).toBe(true);
      }
    });

    it("returns QatQuantConfig with method-specific fields", () => {
      const passes: Passes = {
        ...DEFAULT_PASSES,
        quantization: true,
        quantMethod: "qat",
        qatQuantPrecision: "int4",
        qatCalibrateMethod: "entropy",
        qatCalibrateSteps: 20,
      };
      const config = getQuantConfig(passes)!;
      expect(config.method).toBe("qat");
      if (config.method === "qat") {
        expect(config.qatPrecision).toBe("int4");
        expect(config.calibrateMethod).toBe("entropy");
        expect(config.calibrateSteps).toBe(20);
      }
    });

    it("handles all method variants without throwing", () => {
      const methods: Passes["quantMethod"][] = ["ptq", "awq", "gptq", "qat", "hqq", "rtn", "spinquant", "quarot"];
      for (const method of methods) {
        const config = getQuantConfig({ ...DEFAULT_PASSES, quantization: true, quantMethod: method });
        expect(config).not.toBeNull();
        expect(config!.method).toBe(method);
        expect(config!.enabled).toBe(true);
      }
    });
  });

  describe("getPruningConfig", () => {
    it("returns null when pruning is disabled", () => {
      expect(getPruningConfig({ ...DEFAULT_PASSES, pruning: false })).toBeNull();
    });

    it("returns typed config when pruning is enabled", () => {
      const passes: Passes = {
        ...DEFAULT_PASSES,
        pruning: true,
        pruningSparsity: 0.7,
        pruningType: "structured",
        pruningMethod: "wanda",
        pruningCriteria: "l2_norm",
      };
      const config = getPruningConfig(passes)!;
      expect(config).toEqual({
        enabled: true,
        sparsity: 0.7,
        type: "structured",
        method: "wanda",
        criteria: "l2_norm",
      });
    });
  });

  describe("getPeftConfig", () => {
    it("returns null when PEFT is disabled", () => {
      expect(getPeftConfig({ ...DEFAULT_PASSES, peft: false })).toBeNull();
    });

    it("returns typed config when PEFT is enabled", () => {
      const passes: Passes = { ...DEFAULT_PASSES, peft: true, peftMethod: "qlora", diffusionLora: true };
      const config = getPeftConfig(passes)!;
      expect(config).toEqual({ enabled: true, method: "qlora", diffusionLora: true });
    });
  });

  describe("simple toggles", () => {
    it("isSplittingEnabled returns the splitting boolean", () => {
      expect(isSplittingEnabled(DEFAULT_PASSES)).toBe(false);
      expect(isSplittingEnabled({ ...DEFAULT_PASSES, splitting: true })).toBe(true);
    });

    it("isOnnxTransformsEnabled returns the onnxTransforms boolean", () => {
      expect(isOnnxTransformsEnabled(DEFAULT_PASSES)).toBe(false);
      expect(isOnnxTransformsEnabled({ ...DEFAULT_PASSES, onnxTransforms: true })).toBe(true);
    });
  });

  describe("type narrowing", () => {
    it("AWQ config does not expose GPTQ fields at compile time", () => {
      const config = getQuantConfig({ ...DEFAULT_PASSES, quantization: true, quantMethod: "awq" })!;
      // TypeScript would error if we accessed config.blockSize here without narrowing
      if (config.method === "awq") {
        expect(config.groupSize).toBeDefined();
        expect(config.dampPercent).toBeDefined();
        expect(config.sym).toBeDefined();
        // @ts-expect-error - blockSize does not exist on AwqQuantConfig
        expect(config.blockSize).toBeUndefined();
      }
    });

    it("GPTQ config does not expose AWQ fields at compile time", () => {
      const config = getQuantConfig({ ...DEFAULT_PASSES, quantization: true, quantMethod: "gptq" })!;
      if (config.method === "gptq") {
        expect(config.blockSize).toBeDefined();
        expect(config.groupSize).toBeDefined();
        expect(config.descAct).toBeDefined();
        // @ts-expect-error - dampPercent does not exist on GptqQuantConfig
        expect(config.dampPercent).toBeUndefined();
      }
    });
  });
});
