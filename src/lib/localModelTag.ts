/**
 * Validate model tags accepted by local pull endpoints (`lms get` / `ollama pull`).
 * Allows Hugging Face URLs (preferred for LM Studio) and short engine model ids.
 */
export function isValidLocalModelTag(tag: string): boolean {
  if (!tag || tag.length > 512 || tag.startsWith("-") || /\s/.test(tag)) return false;
  // Absolute URLs: only Hugging Face (used by `lms get`).
  if (/^https?:\/\//i.test(tag)) {
    return /^https:\/\/huggingface\.co\/[\w./%-]+$/i.test(tag);
  }
  return /^[\w./:@-]+$/.test(tag);
}
