/* Feature: ep-expansion-pack, Property 4: MIGraphX Incompatible Pass Conflict Detection */

/**
 * Property-based test validating that getProviderConflicts() always reports
 * at least one critical-severity HardwareConflict when MIGraphXExecutionProvider
 * is selected with any incompatible pass configuration.
 *
 * Incompatible passes for MIGraphX:
 * - conversionFormat: "openvino" (OpenVINO IR conversion)
 * - qairtPipeline: true (QairtPipeline — QNN only)
 * - conversionFormat: "tensorrt" (TensorRT conversion)
 *
 * **Validates: Requirements 4.2**
 */
import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import { getProviderConflicts } from "@/lib/pipelineValidation";
import { kbReady } from "@/lib/schemaEngine";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState } from "@/types";

// Ensure KB is loaded before synchronous validation tests run
beforeAll(async () => {
  await kbReady();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function basePasses(overrides?: Partial<UIState["passes"]>): UIState["passes"] {
  return { ...DEFAULT_PASSES, ...overrides };
}

/**
 * Arbitrary that generates a UIState["passes"] object with MIGraphX-incompatible
 * configurations. At least one of the three incompatible flags is always set.
 */
const incompatiblePassesArb = fc
  .record({
    // Whether to enable OpenVINO IR conversion format
    useOpenVino: fc.boolean(),
    // Whether to enable QairtPipeline
    useQairt: fc.boolean(),
    // Whether to enable TensorRT conversion format
    useTensorrt: fc.boolean(),
    // Random noise: other pass toggles that should not affect the conflict detection
    quantization: fc.boolean(),
    quantMethod: fc.constantFrom("ptq", "awq", "gptq", "hqq", "spinquant", "quarot") as fc.Arbitrary<UIState["passes"]["quantMethod"]>,
    pruning: fc.boolean(),
    pruningType: fc.constantFrom("unstructured", "structured") as fc.Arbitrary<UIState["passes"]["pruningType"]>,
    peft: fc.boolean(),
    peftMethod: fc.constantFrom("lora", "qlora") as fc.Arbitrary<UIState["passes"]["peftMethod"]>,
    onnxTransforms: fc.boolean(),
    splitting: fc.boolean(),
  })
  // Ensure at least one incompatible flag is set
  .filter((cfg) => cfg.useOpenVino || cfg.useQairt || cfg.useTensorrt)
  .map((cfg) => {
    // Determine conversionFormat based on which incompatible flags are enabled.
    // Priority: openvino > tensorrt (if both set, test openvino first — both are critical)
    let conversionFormat: UIState["passes"]["conversionFormat"] = "onnx";
    if (cfg.useOpenVino) {
      conversionFormat = "openvino";
    } else if (cfg.useTensorrt) {
      conversionFormat = "tensorrt";
    }

    return basePasses({
      // Conversion must be enabled for conversionFormat to matter in conflict detection
      conversion: cfg.useOpenVino || cfg.useTensorrt ? true : DEFAULT_PASSES.conversion,
      conversionFormat,
      qairtPipeline: cfg.useQairt,
      quantization: cfg.quantization,
      quantMethod: cfg.quantMethod,
      pruning: cfg.pruning,
      pruningType: cfg.pruningType,
      peft: cfg.peft,
      peftMethod: cfg.peftMethod,
      onnxTransforms: cfg.onnxTransforms,
      splitting: cfg.splitting,
    });
  });

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Property 4: MIGraphX Incompatible Pass Conflict Detection", () => {
  it("reports at least one critical HardwareConflict when any incompatible pass is active with MIGraphXExecutionProvider", () => {
    fc.assert(
      fc.property(incompatiblePassesArb, (passes) => {
        const conflicts = getProviderConflicts("MIGraphXExecutionProvider", passes);
        const criticalConflicts = conflicts.filter((c) => c.severity === "critical");

        // Must have at least one critical conflict
        expect(criticalConflicts.length).toBeGreaterThanOrEqual(1);

        // The critical conflict should reference one of the incompatible pass keys
        const incompatibleKeys = new Set(["conversionFormat", "qairtPipeline"]);
        const hasMeaningfulConflict = criticalConflicts.some((c) =>
          incompatibleKeys.has(c.passKey),
        );
        expect(hasMeaningfulConflict).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("critical conflict references 'conversionFormat' when openvino format is set", () => {
    fc.assert(
      fc.property(
        fc.record({
          quantization: fc.boolean(),
          pruning: fc.boolean(),
          peft: fc.boolean(),
        }),
        (extras) => {
          const passes = basePasses({
            conversion: true,
            conversionFormat: "openvino",
            quantization: extras.quantization,
            pruning: extras.pruning,
            peft: extras.peft,
          });
          const conflicts = getProviderConflicts("MIGraphXExecutionProvider", passes);
          expect(
            conflicts.some(
              (c) => c.passKey === "conversionFormat" && c.severity === "critical",
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("critical conflict references 'qairtPipeline' when qairtPipeline is enabled", () => {
    fc.assert(
      fc.property(
        fc.record({
          quantization: fc.boolean(),
          pruning: fc.boolean(),
          peft: fc.boolean(),
          conversionFormat: fc.constantFrom("onnx") as fc.Arbitrary<UIState["passes"]["conversionFormat"]>,
        }),
        (extras) => {
          const passes = basePasses({
            qairtPipeline: true,
            conversion: true,
            conversionFormat: extras.conversionFormat,
            quantization: extras.quantization,
            pruning: extras.pruning,
            peft: extras.peft,
          });
          const conflicts = getProviderConflicts("MIGraphXExecutionProvider", passes);
          expect(
            conflicts.some(
              (c) => c.passKey === "qairtPipeline" && c.severity === "critical",
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("critical conflict references 'conversionFormat' when tensorrt format is set", () => {
    fc.assert(
      fc.property(
        fc.record({
          quantization: fc.boolean(),
          pruning: fc.boolean(),
          peft: fc.boolean(),
        }),
        (extras) => {
          const passes = basePasses({
            conversion: true,
            conversionFormat: "tensorrt",
            quantization: extras.quantization,
            pruning: extras.pruning,
            peft: extras.peft,
          });
          const conflicts = getProviderConflicts("MIGraphXExecutionProvider", passes);
          expect(
            conflicts.some(
              (c) => c.passKey === "conversionFormat" && c.severity === "critical",
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
