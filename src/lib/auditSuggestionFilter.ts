/**
 * Drop Assistant audit suggestions that contradict the live workspace
 * (wrong modality, wrong EP family, leftover LLM filler).
 */

import type { AiWorkspaceContext } from "./aiWorkspaceContext.ts";
import type { AuditAnalysis, AuditSuggestion } from "./auditAnalysis.ts";
import { canonicalizeAutofixPass, isAuditAutofixApplyable } from "./auditAutofix.ts";

export type AuditFilterContext = Pick<AiWorkspaceContext, "model" | "hardware">;

const ASR_MODEL = /\b(whisper|wav2vec|hubert|speech[\s_-]?t5|asr|automatic[\s_-]?speech|speecht5)\b/i;
const LLM_MODEL =
  /\b(llama|mistral|mixtral|phi-\d|phi\d|qwen|gemma|gpt|falcon|mpt|yi-|deepseek|nemotron|claude|command-r)\b/i;

const SPEECH_JUNK =
  /\b(speech\s*recognition|automatic\s*speech|asr\b|whisper\b|transcrib|voice\s*to\s*text)\b/i;

/** Classic datacenter TensorRT EP / engine-build passes — not NvTensorRT-RTX. */
const CLASSIC_TRT =
  /\b(TensorRTExecutionProvider|TensorrtExecutionProvider|classic\s*tensorrt|add\s*tensorrt\s*execution\s*provider)\b/i;
const TRT_AFTER_CUDA =
  /\bafter\s+CUDAExecutionProvider\b|\bCUDAExecutionProvider\b.*\bTensorRT|TensorRT.*\bCUDAExecutionProvider\b/i;
/** Olive TensorRTPass / “engine build” advice is for classic TRT, not consumer RTX EP. */
const TRT_ENGINE_PASS_JUNK =
  /\b(TensorRTPass|tensor_rt\b|TRT\s*engine|TensorRT\s*engine|engine\s*caching|max_workspace_size|enable_fp16\s*=\s*true)\b/i;
const ADD_TRT_PASS =
  /\b(add|include|enable)\b.{0,40}\b(tensorrt|trt)\b.{0,40}\b(pass|engine|optimization)\b/i;

const OPEN_VINO_ON_NVIDIA = /\b(OpenVINOExecutionProvider|openvino)\b/i;
const QNN_ON_NVIDIA = /\b(QNNExecutionProvider|\bqnn\b)\b/i;

/**
 * Determines whether a model name identifies an automatic speech recognition model.
 *
 * @param displayName - The model name to classify
 * @returns `true` if the model name matches an ASR model pattern, `false` otherwise
 */
export function modelLooksLikeAsr(displayName: string): boolean {
  return ASR_MODEL.test(displayName);
}

/**
 * Determines whether a model name matches a known large language model pattern.
 *
 * @param displayName - The model's display name
 * @returns `true` if the display name matches a known large language model pattern, `false` otherwise.
 */
export function modelLooksLikeLlm(displayName: string): boolean {
  return LLM_MODEL.test(displayName);
}

function suggestionText(s: AuditSuggestion): string {
  return `${s.title}\n${s.description}\n${s.autofix.pass}\n${s.autofix.value}`;
}

/**
 * Determines whether an execution provider belongs to the NVIDIA provider family.
 *
 * @param ep - The execution provider name
 * @returns `true` if the provider is CUDA or TensorRT-based, `false` otherwise.
 */
function isNvidiaFamilyEp(ep: string): boolean {
  return /CUDAExecutionProvider|NvTensorRTRTXExecutionProvider|TensorrtExecutionProvider/.test(ep);
}

/**
 * Determines whether an audit suggestion is relevant to the active model and execution provider.
 *
 * @param suggestion - The audit suggestion to evaluate
 * @param ctx - The active model and hardware context
 * @returns `true` if the suggestion applies to the workspace and has a valid autofix target, `false` otherwise
 */
export function isAuditSuggestionRelevant(suggestion: AuditSuggestion, ctx: AuditFilterContext): boolean {
  const text = suggestionText(suggestion);
  const model = ctx.model.displayName || ctx.model.huggingFaceId || "";
  const ep = ctx.hardware.executionProvider;
  const asr =
    modelLooksLikeAsr(model) ||
    ctx.model.hfTask === "automatic-speech-recognition" ||
    ctx.model.hfTask === "speech-recognition";
  const llm = modelLooksLikeLlm(model);

  // Speech/ASR advice on non-ASR models (classic junk for Llama audits).
  if (!asr && (llm || model.length > 0) && SPEECH_JUNK.test(text)) {
    return false;
  }

  // Already on NvTensorRT-RTX: no classic TRT EP, no TensorRTPass / engine-build cards.
  if (ep === "NvTensorRTRTXExecutionProvider") {
    if (CLASSIC_TRT.test(text) || TRT_AFTER_CUDA.test(text)) return false;
    if (TRT_ENGINE_PASS_JUNK.test(text) || ADD_TRT_PASS.test(text)) return false;
    if (/execution_providers|tensor_rt/i.test(suggestion.autofix.pass) && /tensorrt|trt/i.test(text)) {
      return false;
    }
  }

  // Already on CUDA classic: suggesting "add CUDA" is noise; classic TRT may still be ok.
  if (ep === "CUDAExecutionProvider" && /\badd\s+cuda\b/i.test(text)) {
    return false;
  }

  // Cross-vendor EP noise on NVIDIA GPU targets.
  if (isNvidiaFamilyEp(ep)) {
    if (OPEN_VINO_ON_NVIDIA.test(text) && /execution_provider|switch\s+to|use\s+openvino/i.test(text)) {
      return false;
    }
    if (QNN_ON_NVIDIA.test(text) && /execution_provider|switch\s+to|use\s+qnn/i.test(text)) {
      return false;
    }
  }

  // Drop cards whose Apply target is not a real UI field (nested Olive JSON, TensorRTPass, etc.).
  if (!isAuditAutofixApplyable(suggestion.autofix)) {
    return false;
  }

  return true;
}

/** Rewrite autofix.pass to the canonical UI field when we know the mapping. */
export function normalizeAuditSuggestion(suggestion: AuditSuggestion): AuditSuggestion {
  const key = canonicalizeAutofixPass(suggestion.autofix.pass);
  if (!key || key.startsWith("__")) return suggestion;
  if (key === suggestion.autofix.pass) return suggestion;
  return {
    ...suggestion,
    autofix: { ...suggestion.autofix, pass: key },
  };
}

/**
 * Filters audit suggestions for the active model and execution provider, normalizes applicable autofix fields, and limits the results to three suggestions.
 *
 * @param analysis - The audit analysis containing suggestions and summary text
 * @param ctx - The active model and execution-provider context
 * @returns The filtered and normalized audit analysis
 */
export function filterAuditAnalysis(analysis: AuditAnalysis, ctx: AuditFilterContext): AuditAnalysis {
  const kept = analysis.suggestions
    .filter((s) => isAuditSuggestionRelevant(s, ctx))
    .map(normalizeAuditSuggestion);
  const dropped = analysis.suggestions.length - kept.length;
  let summary = analysis.summary;
  if (dropped > 0) {
    const note = `Removed ${dropped} off-topic suggestion${dropped === 1 ? "" : "s"} that did not match this model/EP.`;
    summary = `${summary.replace(/\s+$/, "")} ${note}`.slice(0, 1200);
  }
  return {
    ...analysis,
    suggestions: kept.slice(0, 3),
    summary,
  };
}
