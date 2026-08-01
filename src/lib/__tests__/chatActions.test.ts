import { describe, it, expect } from "vitest";
import {
  sanitizeChatActionPatch,
  chatPatchToUiState,
  parseChatStructuredReply,
  salvageChatActionPatchFromLooseJson,
  summarizeChatPatch,
} from "@/lib/chatActions";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState, IHVProvider } from "@/types";

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "Qwen/Qwen2.5-1.5B-Instruct",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider" as IHVProvider,
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: {
      ...DEFAULT_PASSES,
      ...overrides?.passes,
    },
  };
}

describe("sanitizeChatActionPatch", () => {
  it("keeps allowlisted EP and pass fields", () => {
    const patch = sanitizeChatActionPatch({
      ihvProvider: "CUDAExecutionProvider",
      passes: { quantization: true, quantMethod: "awq", quantPrecision: "int4", evil: true },
      unknownTop: "nope",
    });
    expect(patch).toEqual({
      ihvProvider: "CUDAExecutionProvider",
      passes: { quantization: true, quantMethod: "awq", quantPrecision: "int4" },
    });
  });

  it("rejects invalid providers and empty patches", () => {
    expect(sanitizeChatActionPatch({ ihvProvider: "NotARealEP" })).toBeNull();
    expect(sanitizeChatActionPatch({})).toBeNull();
    expect(sanitizeChatActionPatch(null)).toBeNull();
  });
});

describe("chatPatchToUiState", () => {
  it("merges passes and enables quantization when method is set", () => {
    const state = baseState();
    const next = chatPatchToUiState(state, {
      ihvProvider: "CUDAExecutionProvider",
      passes: { quantMethod: "awq", quantPrecision: "int4" },
    });
    expect(next.ihvProvider).toBe("CUDAExecutionProvider");
    expect(next.passes?.quantization).toBe(true);
    expect(next.passes?.quantMethod).toBe("awq");
    expect(next.passes?.pruning).toBe(false);
  });
});

describe("parseChatStructuredReply", () => {
  it("parses reply and sanitized actions from JSON", () => {
    const out = parseChatStructuredReply(
      JSON.stringify({
        reply: "Switch to AWQ on CUDA.",
        actions: [
          {
            title: "Enable AWQ INT4",
            description: "Sets CUDA + AWQ",
            patch: {
              ihvProvider: "CUDAExecutionProvider",
              passes: { quantMethod: "awq", quantPrecision: "int4" },
            },
          },
          {
            title: "Bad",
            patch: { ihvProvider: "Nope" },
          },
        ],
      }),
    );
    expect(out.reply).toBe("Switch to AWQ on CUDA.");
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]?.title).toBe("Enable AWQ INT4");
    expect(out.actions[0]?.patch.ihvProvider).toBe("CUDAExecutionProvider");
  });

  it("falls back to plain text when JSON is missing", () => {
    const out = parseChatStructuredReply("Just use CUDA.");
    expect(out.reply).toBe("Just use CUDA.");
    expect(out.actions).toEqual([]);
  });

  it("salvages loose step schemas into an Apply action", () => {
    const out = parseChatStructuredReply(
      JSON.stringify({
        steps: [
          { step: "convert_to_onnx", targetOpset: 14 },
          { step: "apply_quantization", precision: "int8" },
          { step: "validate_model_performance" },
        ],
        note: "Click the Apply button in Olive Studio after patching.",
      }),
    );
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]!.patch.passes?.conversion).toBe(true);
    expect(out.actions[0]!.patch.passes?.conversionOpset).toBe(14);
    expect(out.actions[0]!.patch.passes?.quantization).toBe(true);
    expect(out.actions[0]!.patch.passes?.quantPrecision).toBe("int8");
    expect(out.reply).toMatch(/Apply/i);
  });

  it("salvages step-only convert and quant actions without sibling fields", () => {
    const convertOnly = salvageChatActionPatchFromLooseJson({ step: "convert_to_onnx" });
    expect(convertOnly?.passes?.conversion).toBe(true);
    const quantOnly = salvageChatActionPatchFromLooseJson({ step: "apply_quantization" });
    expect(quantOnly?.passes?.quantization).toBe(true);
    expect(quantOnly?.passes?.quantMethod).toBe("ptq");
  });

  it("does not salvage passes from free-form prose fields like note", () => {
    const noteOnly = salvageChatActionPatchFromLooseJson({
      note: "do not quantize this model",
    });
    expect(noteOnly?.passes?.quantization).toBeUndefined();

    const noteOnly2 = salvageChatActionPatchFromLooseJson({
      note: "conversion is unavailable right now",
    });
    expect(noteOnly2?.passes?.conversion).toBeUndefined();
  });

  it("does not salvage negated step/action prose", () => {
    const negatedQuant = salvageChatActionPatchFromLooseJson({ step: "do not apply quantization" });
    expect(negatedQuant?.passes?.quantization).toBeUndefined();

    const negatedConvert = salvageChatActionPatchFromLooseJson({ step: "skip onnx conversion" });
    expect(negatedConvert?.passes?.conversion).toBeUndefined();

    const contractedQuant = salvageChatActionPatchFromLooseJson({ step: "can't quantize" });
    expect(contractedQuant?.passes?.quantization).toBeUndefined();

    const cannotConvert = salvageChatActionPatchFromLooseJson({ action: "cannot convert to onnx" });
    expect(cannotConvert?.passes?.conversion).toBeUndefined();

    const dontQuantize = salvageChatActionPatchFromLooseJson({ task: "don't apply quantization" });
    expect(dontQuantize?.passes?.quantization).toBeUndefined();

    // Informational/off-topic mentions of "quant" must not enable it either
    // (not negated, but not an affirmative instruction).
    const infoTask = salvageChatActionPatchFromLooseJson({
      task: "check quantization compatibility",
    });
    expect(infoTask?.passes?.quantization).toBeUndefined();
  });

  it("salvages quant method tokens from multi-word action values", () => {
    // Bare method names ("gptq") don't contain the substring "quant", and
    // combined phrases ("apply awq") don't exact-match a single token —
    // both must still be recognized via per-token matching.
    const applyAwq = salvageChatActionPatchFromLooseJson({ step: "apply awq" });
    expect(applyAwq?.passes?.quantization).toBe(true);
    expect(applyAwq?.passes?.quantMethod).toBe("awq");

    const bareGptq = salvageChatActionPatchFromLooseJson({ task: "gptq" });
    expect(bareGptq?.passes?.quantization).toBe(true);
    expect(bareGptq?.passes?.quantMethod).toBe("gptq");

    const applyInt8 = salvageChatActionPatchFromLooseJson({ step: "apply int8 quantization" });
    expect(applyInt8?.passes?.quantization).toBe(true);
    expect(applyInt8?.passes?.quantPrecision).toBe("int8");
  });

  it("scopes negation to the specific instruction it modifies", () => {
    // Only quantization is negated here; conversion is a separate,
    // non-negated instruction in the same value and must still salvage.
    const mixed = salvageChatActionPatchFromLooseJson({
      step: "convert to onnx without quantization",
    });
    expect(mixed?.passes?.conversion).toBe(true);
    expect(mixed?.passes?.quantization).toBeUndefined();
  });

  it("strips misleading Apply instructions when no patch exists", () => {
    const out = parseChatStructuredReply(
      JSON.stringify({
        reply: "Consider reading the docs.\n\nClick the **Apply** button in Olive Studio.",
        actions: [],
      }),
    );
    expect(out.actions).toEqual([]);
    expect(out.reply).toMatch(/No Applyable patch/i);
  });
});

describe("summarizeChatPatch", () => {
  it("lists key fields", () => {
    expect(
      summarizeChatPatch({
        ihvProvider: "CUDAExecutionProvider",
        passes: { quantMethod: "awq" },
      }),
    ).toContain("EP=CUDAExecutionProvider");
  });
});
