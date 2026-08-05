import { beforeEach, describe, expect, it, vi } from "vitest";

const fromPretrained = vi.fn();

vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: {
    from_pretrained: (...args: unknown[]) => fromPretrained(...args),
  },
}));

import {
  detectArenaModelKind,
  promptDerivedTokenIds,
  buildNlpFeedsFromTokenIds,
  buildSyntheticFeeds,
  buildArenaLocalFeeds,
  resolvePromptTokenIds,
  hashSeed,
} from "@/lib/arenaLocalInference";

describe("detectArenaModelKind", () => {
  it("detects NLP from input_ids / attention_mask", () => {
    expect(detectArenaModelKind(["input_ids", "attention_mask"])).toBe("nlp");
    expect(detectArenaModelKind(["input_ids"])).toBe("nlp");
  });

  it("detects vision from pixel_values", () => {
    expect(detectArenaModelKind(["pixel_values"])).toBe("vision");
  });

  it("falls back to generic", () => {
    expect(detectArenaModelKind(["x", "y"])).toBe("generic");
  });
});

describe("promptDerivedTokenIds", () => {
  it("is deterministic and fixed length", () => {
    const a = promptDerivedTokenIds("hello arena", 16);
    const b = promptDerivedTokenIds("hello arena", 16);
    expect(a).toEqual(b);
    expect(a).toHaveLength(16);
    expect(a.slice(0, 11).every((id) => id > 0)).toBe(true);
    expect(a.slice(11).every((id) => id === 0)).toBe(true);
  });

  it("differs for different prompts", () => {
    expect(promptDerivedTokenIds("alpha", 8)).not.toEqual(promptDerivedTokenIds("beta", 8));
  });
});

describe("feed builders", () => {
  class FakeTensor {
    constructor(
      public type: string,
      public data: ArrayBufferView,
      public dims: number[],
    ) {}
  }
  const ort = {
    Tensor: FakeTensor as unknown as new (
      type: string,
      data: Float32Array | BigInt64Array | Int32Array,
      dims: number[],
    ) => unknown,
  };

  it("buildNlpFeedsFromTokenIds maps common NLP inputs", () => {
    const ids = [10, 20, 30, 0, 0];
    const feeds = buildNlpFeedsFromTokenIds(ort, ["input_ids", "attention_mask", "token_type_ids"], ids);
    expect(Object.keys(feeds).sort()).toEqual([
      "attention_mask",
      "input_ids",
      "token_type_ids",
    ]);
    const mask = feeds.attention_mask as FakeTensor;
    expect(Array.from(mask.data as BigInt64Array).map(Number)).toEqual([1, 1, 1, 0, 0]);
  });

  it("buildSyntheticFeeds is seed-stable", () => {
    const a = buildSyntheticFeeds(ort, ["feat"], "seed-1", 8) as {
      feat: FakeTensor;
    };
    const b = buildSyntheticFeeds(ort, ["feat"], "seed-1", 8) as {
      feat: FakeTensor;
    };
    expect(Array.from(a.feat.data as Float32Array)).toEqual(Array.from(b.feat.data as Float32Array));
    expect(hashSeed("seed-1")).toBe(hashSeed("seed-1"));
  });
});

describe("resolvePromptTokenIds", () => {
  beforeEach(() => {
    fromPretrained.mockReset();
  });

  it("uses prompt-derived ids when prompt is empty (skips transformers)", async () => {
    const result = await resolvePromptTokenIds("   ", null, 8);
    expect(fromPretrained).not.toHaveBeenCalled();
    expect(result.source).toBe("prompt-derived");
    expect(result.tokenizerId).toBeNull();
    expect(result.tokenIds).toEqual(promptDerivedTokenIds("   ", 8));
  });

  it("falls back to prompt-derived when transformers tokenize fails", async () => {
    fromPretrained.mockRejectedValue(new Error("offline"));
    const result = await resolvePromptTokenIds("hello arena", "Xenova/gpt2", 16);
    expect(result.source).toBe("prompt-derived");
    expect(result.tokenIds).toEqual(promptDerivedTokenIds("hello arena", 16));
  });

  it("uses transformers ids when tokenization succeeds", async () => {
    fromPretrained.mockResolvedValue(async () => ({
      input_ids: { data: [11, 22, 33] },
    }));
    const result = await resolvePromptTokenIds("hello arena", "Xenova/gpt2", 8);
    expect(result.source).toBe("transformers");
    expect(result.tokenizerId).toBe("Xenova/gpt2");
    expect(result.tokenIds.slice(0, 3)).toEqual([11, 22, 33]);
    expect(result.tokenIds).toHaveLength(8);
  });
});

describe("buildArenaLocalFeeds", () => {
  class FakeTensor {
    constructor(
      public type: string,
      public data: ArrayBufferView,
      public dims: number[],
    ) {}
  }
  const ort = {
    Tensor: FakeTensor as unknown as new (
      type: string,
      data: Float32Array | BigInt64Array | Int32Array,
      dims: number[],
    ) => unknown,
  };

  beforeEach(() => {
    fromPretrained.mockReset();
    fromPretrained.mockRejectedValue(new Error("offline"));
  });

  it("builds NLP feeds from prompt-derived token ids", async () => {
    const { kind, feeds, tokenize } = await buildArenaLocalFeeds(
      ort,
      ["input_ids", "attention_mask"],
      { prompt: "compare me", seedKey: "unused", tokenizerId: null },
    );
    expect(kind).toBe("nlp");
    expect(tokenize?.source).toBe("prompt-derived");
    expect(feeds.input_ids).toBeDefined();
    expect(feeds.attention_mask).toBeDefined();
  });

  it("uses synthetic feeds for vision models even with a prompt", async () => {
    const { kind, feeds, tokenize } = await buildArenaLocalFeeds(ort, ["pixel_values"], {
      prompt: "ignored for vision",
      seedKey: "vision-seed",
    });
    expect(kind).toBe("vision");
    expect(tokenize).toBeUndefined();
    expect(feeds.pixel_values).toBeDefined();
  });

  it("uses synthetic feeds for NLP when prompt is blank", async () => {
    const { kind, tokenize } = await buildArenaLocalFeeds(ort, ["input_ids"], {
      prompt: "  ",
      seedKey: "blank-nlp",
    });
    expect(kind).toBe("nlp");
    expect(tokenize).toBeUndefined();
  });
});
