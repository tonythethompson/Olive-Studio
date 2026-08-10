import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveQnnHostMode } from "../../../lib/qnnDeps.ts";
import { fingerprintRecipe, preflightOliveRecipe } from "./jobPreflight.ts";
import type { OliveRecipe } from "../../types.ts";

vi.mock("../../../lib/qnnDeps.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/qnnDeps.ts")>();
  return {
    ...actual,
    resolveQnnHostMode: vi.fn(actual.resolveQnnHostMode),
  };
});

function minimalRecipe(ep = "CPUExecutionProvider"): OliveRecipe {
  // Cast via unknown: server OliveRecipe accelerators omit optional `device`.
  return {
    input_model: { type: "PyTorchModel", config: {} },
    systems: {
      local_system: {
        type: "LocalSystem",
        config: {
          accelerators: [{ device: "cpu", execution_providers: [ep] }],
        },
      },
    },
    passes: {
      conversion: { type: "OnnxConversion", config: { target_opset: 20 } },
    },
    engine: {
      search_strategy: false,
      host: "local_system",
      target: "local_system",
      cache_dir: "./cache",
      output_dir: "./out",
    },
  } as unknown as OliveRecipe;
}

describe("preflightOliveRecipe", () => {
  it("accepts a minimal CPU recipe and returns fingerprint", () => {
    const pre = preflightOliveRecipe(minimalRecipe());
    expect(pre.valid).toBe(true);
    expect(pre.provider).toBe("CPUExecutionProvider");
    expect(pre.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(pre.errors).toEqual([]);
  });

  it("fingerprint is stable for same recipe", () => {
    const a = fingerprintRecipe(minimalRecipe(), "auto");
    const b = fingerprintRecipe(minimalRecipe(), "auto");
    expect(a).toBe(b);
  });

  it("fingerprint changes with cudaVersion", () => {
    const r = minimalRecipe();
    expect(fingerprintRecipe(r, "auto")).not.toBe(fingerprintRecipe(r, "cu124"));
  });

  it("reads accelerators from systems.local_system when config omits them", () => {
    // Schema still wants config.accelerators, but provider lookup must not
    // silently fall back to CPU when the EP only exists on the top-level shape.
    const recipe = {
      input_model: { type: "PyTorchModel", config: {} },
      systems: {
        local_system: {
          type: "LocalSystem",
          config: {},
          accelerators: [{ device: "cpu", execution_providers: ["CUDAExecutionProvider"] }],
        },
      },
      passes: {
        conversion: { type: "OnnxConversion", config: { target_opset: 20 } },
      },
      engine: {
        search_strategy: false,
        host: "local_system",
        target: "local_system",
        cache_dir: "./cache",
        output_dir: "./out",
      },
    } as unknown as OliveRecipe;
    const pre = preflightOliveRecipe(recipe);
    expect(pre.provider).toBe("CUDAExecutionProvider");
    // Without config.accelerators the structural schema still fails; provider must be correct.
    expect(pre.errors.some((e) => /unknown execution provider/i.test(e))).toBe(false);
  });

  it("rejects unknown execution providers", () => {
    const pre = preflightOliveRecipe(minimalRecipe("NotARealProvider"));
    expect(pre.valid).toBe(false);
    expect(pre.provider).toBeNull();
    expect(pre.errors.some((e) => /unknown execution provider/i.test(e))).toBe(true);
  });

  it("rejects export-target providers for local Olive runs", () => {
    const pre = preflightOliveRecipe(minimalRecipe("WebGpuExecutionProvider"));
    expect(pre.valid).toBe(false);
    expect(pre.provider).toBe("WebGpuExecutionProvider");
    expect(pre.errors.some((e) => /cannot run via local Olive/i.test(e))).toBe(true);
  });

  it("rewrites non-canonical EP tokens in the preflight recipe", () => {
    const pre = preflightOliveRecipe(minimalRecipe("cuda"));
    expect(pre.valid).toBe(true);
    expect(pre.provider).toBe("CUDAExecutionProvider");
    const accel =
      pre.recipe.systems?.local_system?.config?.accelerators?.[0] ??
      pre.recipe.systems?.local_system?.accelerators?.[0];
    expect(accel?.execution_providers?.[0]).toBe("CUDAExecutionProvider");
  });

  it("warns on unusual cudaVersion tokens without failing validation", () => {
    const pre = preflightOliveRecipe(minimalRecipe(), "not-a-cuda-token");
    expect(pre.valid).toBe(true);
    expect(pre.warnings.some((w) => /unusual cudaversion token/i.test(w))).toBe(true);
  });

  it("fingerprint omits undefined object values like JSON.stringify", () => {
    const withUndef = { a: 1, b: undefined as unknown as number, c: 2 };
    const without = { a: 1, c: 2 };
    expect(fingerprintRecipe(withUndef, "auto")).toBe(fingerprintRecipe(without, "auto"));
  });

  it("QNN validate stays structural: deferred readiness warning on local-inference", () => {
    vi.mocked(resolveQnnHostMode).mockReturnValue("local-inference");
    const pre = preflightOliveRecipe(minimalRecipe("QNNExecutionProvider"));
    // Missing NPU/runtime must not fail sync validate (probe is deferred to startOliveJob).
    expect(pre.errors.some((e) => /npu|runtime not ready/i.test(e))).toBe(false);
    expect(pre.warnings.some((w) => /npu\/runtime readiness is not checked at validate/i.test(w))).toBe(
      true,
    );
  });

  it("QnnAbi validate uses the same structural QNN readiness path", () => {
    vi.mocked(resolveQnnHostMode).mockReturnValue("local-inference");
    const pre = preflightOliveRecipe(minimalRecipe("QnnAbiExecutionProvider"));
    expect(pre.errors.some((e) => /npu|runtime not ready/i.test(e))).toBe(false);
    expect(pre.warnings.some((w) => /npu\/runtime readiness is not checked at validate/i.test(w))).toBe(
      true,
    );
  });

  it("QNN out-of-scope host skips deferred-readiness warning without NPU hard-fail", () => {
    vi.mocked(resolveQnnHostMode).mockReturnValue("out-of-scope");
    const pre = preflightOliveRecipe(minimalRecipe("QNNExecutionProvider"));
    expect(pre.errors.some((e) => /npu|runtime not ready/i.test(e))).toBe(false);
    expect(pre.warnings.some((w) => /npu\/runtime readiness is not checked at validate/i.test(w))).toBe(
      false,
    );
  });

  describe("path safety validation", () => {
    it("rejects input_model.config.model_path with .. traversal", () => {
      const recipe = minimalRecipe();
      recipe.input_model.config = { model_path: "../../../etc/passwd" };
      const pre = preflightOliveRecipe(recipe);
      expect(pre.valid).toBe(false);
      expect(pre.errors.some((e) => /input_model\.config\.model_path.*not a safe reference model path/i.test(e))).toBe(true);
    });

    it("rejects pass config paths outside the project root", () => {
      const recipe = minimalRecipe();
      recipe.passes = {
        conversion: {
          type: "OnnxConversion",
          config: { target_opset: 20, model_path: "/etc/passwd" },
        },
      };
      const pre = preflightOliveRecipe(recipe);
      expect(pre.valid).toBe(false);
      expect(pre.errors.some((e) => /passes\.conversion\.config\.model_path.*outside the approved model root/i.test(e))).toBe(true);
    });

    it("rejects UNC paths in pass configs", () => {
      const recipe = minimalRecipe();
      recipe.passes = {
        conversion: {
          type: "OnnxConversion",
          config: { target_opset: 20, data_dir: "\\\\server\\share\\data" },
        },
      };
      const pre = preflightOliveRecipe(recipe);
      expect(pre.valid).toBe(false);
      expect(pre.errors.some((e) => /passes\.conversion\.config\.data_dir.*UNC paths are not allowed/i.test(e))).toBe(true);
    });

    it("rejects in-root symlink that resolves outside the project root", () => {
      let tmpDir: string | null = null;
      let symlinkPath: string | null = null;

      try {
        // Create a temp directory outside the project root
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "olive-preflight-outside-"));
        const outsideTarget = path.join(tmpDir, "outside-data");
        fs.mkdirSync(outsideTarget);

        // Create a symlink inside the project root that points to the outside target
        const projectRoot = process.cwd();
        symlinkPath = path.join(projectRoot, "symlink-to-outside");

        // Create the symlink (may fail on Windows without privilege; gracefully skip)
        try {
          fs.symlinkSync(outsideTarget, symlinkPath, "dir");
        } catch (symlinkErr) {
          // Symlink creation failed (likely permissions); skip this test
          console.warn("Skipping symlink test: symlink creation not supported in this environment");
          return;
        }

        // Build a recipe that references the symlink via a pass config path
        const recipe = minimalRecipe();
        recipe.passes = {
          conversion: {
            type: "OnnxConversion",
            config: { target_opset: 20, data_dir: "symlink-to-outside" },
          },
        };

        // The preflight should reject the symlink because it canonicalizes to outside the project root
        const pre = preflightOliveRecipe(recipe);
        expect(pre.valid).toBe(false);
        expect(pre.errors.some((e) => /passes\.conversion\.config\.data_dir.*outside the approved model root/i.test(e))).toBe(true);
      } finally {
        // Cleanup
        if (symlinkPath && fs.existsSync(symlinkPath)) {
          fs.unlinkSync(symlinkPath);
        }
        if (tmpDir && fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    });
  });
});
