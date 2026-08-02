import { describe, it, expect } from "vitest";
import {
  detectArenaModelKind,
  promptDerivedTokenIds,
  buildNlpFeedsFromTokenIds,
  buildSyntheticFeeds,
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
