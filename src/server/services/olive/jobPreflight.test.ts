import { describe, expect, it } from "vitest";
import { fingerprintRecipe, preflightOliveRecipe } from "./jobPreflight.ts";
import type { OliveRecipe } from "../../types.ts";

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
});
