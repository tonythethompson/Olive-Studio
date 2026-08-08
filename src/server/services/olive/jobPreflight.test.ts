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
});
