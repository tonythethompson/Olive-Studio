/**
 * Local Arena ONNX feed builders: model-type detection + prompt-aware NLP tensors.
 *
 * Full HF tokenizers are loaded lazily via @huggingface/transformers when available.
 * If the tokenizer fails (offline / missing package / bad id), we fall back to a
 * deterministic prompt-derived encoding so both slots still compare the same request.
 */

export type ArenaModelKind = "nlp" | "vision" | "generic";

export const DEFAULT_ARENA_TOKENIZER_ID = "Xenova/gpt2";
export const ARENA_MAX_SEQ_LEN = 128;

/** Classify an ONNX session from its input tensor names. */
export function detectArenaModelKind(inputNames: readonly string[]): ArenaModelKind {
  const lower = inputNames.map((n) => n.toLowerCase());
  const hasNlp = lower.some(
    (n) =>
      n.includes("input_ids") ||
      n.includes("attention_mask") ||
      n.includes("token_type") ||
      (n.includes("token") && n.includes("id")),
  );
  if (hasNlp) return "nlp";

  const hasVision = lower.some(
    (n) =>
      n.includes("pixel_values") ||
      n.includes("image") ||
      n === "input" ||
      n.includes("images"),
  );
  // Heuristic: NCHW-ish names alone aren't enough; prefer explicit vision names
  if (hasVision) return "vision";
  return "generic";
}

/** Deterministic PRNG for synthetic (non-prompt) feeds. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Prompt-derived token ids when a real HF tokenizer is unavailable.
 * Maps UTF-16 code units into a stable id space and pads/truncates to maxLen.
 * Not vocabulary-faithful, but both slots share identical ids for the same prompt.
 */
export function promptDerivedTokenIds(prompt: string, maxLen = ARENA_MAX_SEQ_LEN): number[] {
  const ids: number[] = [];
  const text = prompt.length > 0 ? prompt : " ";
  for (let i = 0; i < Math.min(text.length, maxLen); i++) {
    // Keep ids in a positive int32-friendly range common to embedding tables
    ids.push((text.charCodeAt(i) % 50000) + 1);
  }
  while (ids.length < maxLen) ids.push(0);
  return ids;
}

/**
 * Tokenize with @huggingface/transformers AutoTokenizer when the package is present.
 * Returns null on any failure so callers can fall back.
 */
export async function tokenizePromptWithTransformers(
  prompt: string,
  tokenizerId: string,
  maxLen = ARENA_MAX_SEQ_LEN,
): Promise<number[] | null> {
  try {
    const mod = await import("@huggingface/transformers");
    const AutoTokenizer = (mod as { AutoTokenizer?: { from_pretrained: (id: string) => Promise<unknown> } })
      .AutoTokenizer;
    if (!AutoTokenizer) return null;

    const tokenizer = (await AutoTokenizer.from_pretrained(tokenizerId)) as {
      (
        text: string,
        opts?: Record<string, unknown>,
      ): Promise<{ input_ids?: { data?: ArrayLike<number> } | ArrayLike<number> }> | {
        input_ids?: { data?: ArrayLike<number> } | ArrayLike<number>;
      };
    };

    const encoded = await tokenizer(prompt, {
      add_special_tokens: true,
      truncation: true,
      max_length: maxLen,
      padding: false,
    });

    const raw = encoded?.input_ids;
    if (!raw) return null;
    const data = (typeof raw === "object" && raw !== null && "data" in raw
      ? (raw as { data: ArrayLike<number> }).data
      : (raw as ArrayLike<number>)) as ArrayLike<number>;

    const ids = Array.from(data, (n) => Number(n));
    if (!ids.length) return null;
    if (ids.length > maxLen) return ids.slice(0, maxLen);
    while (ids.length < maxLen) ids.push(0);
    return ids;
  } catch {
    return null;
  }
}

export type TokenizeResult = {
  tokenIds: number[];
  source: "transformers" | "prompt-derived";
  tokenizerId: string | null;
};

/** Prefer transformers.js; always returns ids (prompt-derived fallback). */
export async function resolvePromptTokenIds(
  prompt: string,
  tokenizerId?: string | null,
  maxLen = ARENA_MAX_SEQ_LEN,
): Promise<TokenizeResult> {
  const id = (tokenizerId?.trim() || DEFAULT_ARENA_TOKENIZER_ID);
  if (prompt.trim()) {
    const fromHf = await tokenizePromptWithTransformers(prompt, id, maxLen);
    if (fromHf) {
      return { tokenIds: fromHf, source: "transformers", tokenizerId: id };
    }
  }
  return {
    tokenIds: promptDerivedTokenIds(prompt, maxLen),
    source: "prompt-derived",
    tokenizerId: null,
  };
}

export type OrtLike = {
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array | Int32Array,
    dims: number[],
  ) => unknown;
};

/**
 * Build ORT feeds for NLP models from real/fallback token ids.
 * Shared tokenIds keep Slot A/B comparable.
 */
export function buildNlpFeedsFromTokenIds(
  ort: OrtLike,
  inputNames: readonly string[],
  tokenIds: number[],
): Record<string, unknown> {
  const seq = tokenIds.length;
  const ids = BigInt64Array.from(tokenIds, (n) => BigInt(n));
  const mask = BigInt64Array.from({ length: seq }, (_, i) => (tokenIds[i]! !== 0 ? 1n : 0n));
  // If every id is non-zero after pad-with-zero, ensure at least first token is attended
  if (mask.every((v) => v === 0n) && seq > 0) mask[0] = 1n;
  const tokenType = BigInt64Array.from({ length: seq }, () => 0n);

  const feeds: Record<string, unknown> = {};
  for (const name of inputNames) {
    const lower = name.toLowerCase();
    if (/input_ids|token_ids|(^|_)ids$/.test(lower) && !/mask|type|position/.test(lower)) {
      feeds[name] = new ort.Tensor("int64", ids, [1, seq]);
    } else if (/attention_mask|padding_mask|(^|_)mask$/.test(lower) && !/type/.test(lower)) {
      feeds[name] = new ort.Tensor("int64", mask, [1, seq]);
    } else if (/token_type|segment/.test(lower)) {
      feeds[name] = new ort.Tensor("int64", tokenType, [1, seq]);
    } else if (/position_ids/.test(lower)) {
      const pos = BigInt64Array.from({ length: seq }, (_, i) => BigInt(i));
      feeds[name] = new ort.Tensor("int64", pos, [1, seq]);
    } else {
      // Unknown extra input — zeros float32 [1, seq] to avoid random divergence
      feeds[name] = new ort.Tensor("float32", new Float32Array(seq), [1, seq]);
    }
  }
  return feeds;
}

/** Synthetic feeds for vision/generic models (seeded for A/B parity). */
export function buildSyntheticFeeds(
  ort: OrtLike,
  inputNames: readonly string[],
  seedKey: string,
  seq = ARENA_MAX_SEQ_LEN,
): Record<string, unknown> {
  const rng = mulberry32(hashSeed(seedKey || "arena-local"));
  const feeds: Record<string, unknown> = {};

  for (const name of inputNames) {
    const lower = name.toLowerCase();
    if (/input_ids|token_ids|ids$/.test(lower) && !/mask|type/.test(lower)) {
      const data = BigInt64Array.from({ length: seq }, () => BigInt(Math.floor(rng() * 1000)));
      feeds[name] = new ort.Tensor("int64", data, [1, seq]);
    } else if (/attention_mask|padding_mask|mask$/.test(lower)) {
      feeds[name] = new ort.Tensor("int64", BigInt64Array.from({ length: seq }, () => 1n), [1, seq]);
    } else if (/token_type|segment/.test(lower)) {
      feeds[name] = new ort.Tensor("int64", BigInt64Array.from({ length: seq }, () => 0n), [1, seq]);
    } else if (/pixel_values|image/.test(lower)) {
      // Common NCHW stub: 1x3x224x224
      const n = 1 * 3 * 224 * 224;
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = rng() * 2 - 1;
      feeds[name] = new ort.Tensor("float32", data, [1, 3, 224, 224]);
    } else {
      const data = new Float32Array(seq);
      for (let i = 0; i < seq; i++) data[i] = rng() * 2 - 1;
      feeds[name] = new ort.Tensor("float32", data, [1, seq]);
    }
  }
  return feeds;
}

/**
 * Choose feeds for a session: NLP+prompt → tokenized; otherwise synthetic seed.
 */
export async function buildArenaLocalFeeds(
  ort: OrtLike,
  inputNames: readonly string[],
  opts: { prompt: string; seedKey: string; tokenizerId?: string | null },
): Promise<{ feeds: Record<string, unknown>; kind: ArenaModelKind; tokenize?: TokenizeResult }> {
  const kind = detectArenaModelKind(inputNames);
  if (kind === "nlp" && opts.prompt.trim()) {
    const tokenize = await resolvePromptTokenIds(opts.prompt, opts.tokenizerId);
    return {
      kind,
      tokenize,
      feeds: buildNlpFeedsFromTokenIds(ort, inputNames, tokenize.tokenIds),
    };
  }
  return {
    kind,
    feeds: buildSyntheticFeeds(ort, inputNames, opts.seedKey || opts.prompt || "arena-local"),
  };
}
