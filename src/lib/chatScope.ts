/**
 * Lightweight scope + abuse gate for Olive Studio chat.
 * Prompt instructions still apply; this catches obvious off-topic / hard-abuse / safety turns
 * before spending an LLM call (and before weak models answer anyway).
 *
 * Colorful swearing on an Olive-scoped question is allowed.
 * Hate, sexual content, and suicidal / dangerous / obsessive harm topics are not.
 */

const OLIVE_TOPIC =
  /\b(olive|onnx|ort|tensorrt|cuda|rocm|awq|gptq|ptq|qat|hqq|quant(?:ize|ization|s)?|prun(?:e|ing)?|lora|qlora|peft|huggingface|vram|gpu|execution\s*provider|\bep\b|opset|recipe|pipeline|ihv|nvtensor|openvino|qnn|conversion|calibration|bitsandbytes|transformers?|models?|weights?|checkpoint|safetensors?|gguf|shrink|compress|smaller|footprint|memory|optimiz(?:e|ation)|int[48]|fp(?:8|16)|bf16|pass(?:es)?)\b/i;

/** Clear non-Olive intents (trivia, personal, sexual, medical, etc.). */
const OFF_TOPIC =
  /\b(babies?|baby|where do .+ come from|sex|sexual|pregnant|pregnancy|porn|porno|dating|girlfriend|boyfriend|politics|religion|homework|essay|poem|joke|recipe for (?:cake|cookies|pasta)|how (?:old|tall) (?:am|are) i)\b/i;

/**
 * Casual swearing / insults. Ignored when the message looks Olive-related;
 * still blocked when there is no product scope (keeps pure vents out of the model).
 */
const PROFANITY =
  /\b(?:f+u+c+k+(?:ing|er|ed)?|f+u+k+|f+c+k+|sh+i+t+(?:ty|s)?|b+i+t+c+h+(?:es|y)?|a+s+s+h+o+l+e+s?|c+u+n+t+s?|d+i+c+k+(?:s|head)?|p+u+s+s+y+|c+o+c+k+s?|w+h+o+r+e+s?|hos?|s+l+u+t+s?|goddamn|damn)\b/i;

/**
 * Hate speech and sexual content. Always blocked, even on Olive-scoped messages.
 * Matched against a normalized form (leet / spaced letters).
 */
const HARD_ABUSE =
  /\b(?:n+i+g+(?:g+)?(?:e+r+|a+)s?|f+a+g+(?:g+o*t+)?s?|r+e+t+a+r+d+(?:ed|s)?|k+i+k+e+s?|s+p+i+c+s?|c+h+i+n+k+s?|t+r+a+n+n+y+|k+y+k+e+s?|b+e+a+n+e+r+s?|w+e+t+b+a+c+k+s?|g+o+o+k+s?|p+o+r+n+(?:o|ography)?|only\s*fans|hentai|nsfw|nude|nudes|naked|blowjob|handjob|cumshot|orgasm|masturbat(?:e|ion)|rape|raping|send\s+nudes)\b/i;

/**
 * Self-harm / suicide, violence facilitation, and obsessive harm fixation.
 * Always blocked (phrase-level so "kill the process" / "data poisoning" stay usable).
 */
const SAFETY_CRISIS =
  /\b(?:kill\s+(?:my\s*)?self|kys\b|suicid(?:e|al)|end\s+my\s+life|take\s+my\s+own\s+life|want\s+to\s+die|wish\s+i\s+(?:were|was)\s+dead|self[\s-]?harm|hurt\s+myself|cut\s+myself|hang\s+myself|overdose\s+(?:on|with)|don'?t\s+want\s+to\s+(?:live|be\s+alive)|better\s+off\s+dead)\b/i;

const SAFETY_DANGEROUS =
  /\b(?:(?:how\s+to\s+)?(?:make|build|create)\s+(?:a\s+)?(?:bomb|explosive)|mass\s+shooting|school\s+shooting|how\s+to\s+(?:kill|murder)\s+(?:someone|people|him|her|them)|make\s+ricin|build\s+(?:an?\s+)?(?:illegal\s+)?(?:gun|weapon)|commit\s+(?:a\s+)?(?:murder|massacre))\b/i;

const SAFETY_OBSESSIVE =
  /\b(?:stalk(?:ing|er)?\b|doxx?(?:ing)?|can'?t\s+stop\s+thinking\s+about\s+you|obsessed\s+with\s+you|follow\s+(?:them|her|him)\s+home|watch\s+(?:them|her|him)\s+(?:sleep|shower)|track\s+(?:their|her|his)\s+location)\b/i;

export const OLIVE_SCOPE_REFUSAL =
  "I only help with **Olive Studio** and Microsoft Olive model optimization (conversion, quantization, pruning, PEFT, ONNX Runtime / hardware EPs, recipes, and VRAM).\n\nAsk something about your pipeline, passes, or target EP, and I will help.";

export const OLIVE_ABUSE_REFUSAL =
  "Please keep this chat **professional** and focused on Olive Studio / model optimization. I will not engage with sexual or hateful language.";

export const OLIVE_SAFETY_REFUSAL =
  "I can't help with self-harm, violence, or harmful fixation topics.\n\nIf you are in crisis or thinking about harming yourself, please seek help right away:\n- International resources: https://www.iasp.info/suicidalthoughts/\n- US & territories: call or text **988** (Suicide & Crisis Lifeline)\n- If someone is in immediate danger, contact local emergency services.\n\nI only assist with Olive Studio / model optimization. If you have a pipeline or ONNX question, ask that and I will help.";

export type ChatScopeBlockReason = "off_topic" | "abuse" | "safety";

export type ChatScopeBlock = {
  reason: ChatScopeBlockReason;
  reply: string;
};

/**
 * Normalizes chat text for consistent scope and safety pattern matching.
 *
 * @param raw - The unnormalized chat message
 * @returns The normalized message with obfuscating character substitutions and spacing simplified
 */
export function normalizeChatForScope(raw: string): string {
  let text = raw
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[@4]/g, "a")
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/(.)\1{2,}/g, "$1$1") // fuuuuck → fuuck (still matches f+u+c+k+)
    // Keep phrase boundaries: kill-myself / how_to_make_a_bomb stay multi-word.
    .replace(/[-_./\\]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, "") // f.u.c.k / f*ck → fuck
    .replace(/\s+/g, " ")
    .trim();

  // Collapse spaced-out letters: "f u c k you" → "fuck you"
  text = text.replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (match) => match.replace(/\s+/g, ""));
  return text;
}

const matchesAny = (patterns: RegExp[], ...samples: string[]): boolean =>
  samples.some((sample) => patterns.some((pattern) => pattern.test(sample)));

/**
 * Evaluates a chat message for safety, abuse, and Olive Studio scope violations.
 *
 * @param message - The chat message to evaluate
 * @returns A block reason and refusal reply when the message is blocked, or `null` when it is allowed.
 */
export function getChatScopeBlock(message: string): ChatScopeBlock | null {
  const text = message.trim();
  if (!text) return null;

  const normalized = normalizeChatForScope(text);

  if (matchesAny([SAFETY_CRISIS, SAFETY_DANGEROUS, SAFETY_OBSESSIVE], normalized, text)) {
    return { reason: "safety", reply: OLIVE_SAFETY_REFUSAL };
  }

  if (matchesAny([HARD_ABUSE], normalized, text)) {
    return { reason: "abuse", reply: OLIVE_ABUSE_REFUSAL };
  }

  // Explicit off-topic beats a lone Olive keyword (e.g. "recipe for cake").
  if (matchesAny([OFF_TOPIC], normalized, text)) {
    return { reason: "off_topic", reply: OLIVE_SCOPE_REFUSAL };
  }

  const oliveRelated = matchesAny([OLIVE_TOPIC], text, normalized);
  if (oliveRelated) return null;

  if (matchesAny([PROFANITY], normalized, text)) {
    return { reason: "abuse", reply: OLIVE_ABUSE_REFUSAL };
  }

  return null;
}

/** @deprecated Prefer getChatScopeBlock; kept for callers/tests that only need a boolean. */
export function isClearlyOffTopicOliveChat(message: string): boolean {
  return getChatScopeBlock(message)?.reason === "off_topic";
}
