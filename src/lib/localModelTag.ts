/**
 * Validate model tags accepted by local pull endpoints (`lms get` / `ollama pull`).
 * Allows Hugging Face URLs (preferred for LM Studio) and short engine model ids.
 * Rejects relative/absolute filesystem paths that must never reach the engine CLI.
 */
export function isValidLocalModelTag(tag: string): boolean {
  if (!tag || tag.length > 512 || tag.startsWith("-") || /\s/.test(tag)) return false;
  // Absolute URLs: only Hugging Face (used by `lms get`).
  if (/^https?:\/\//i.test(tag)) {
    return /^https:\/\/huggingface\.co\/[\w./%-]+$/i.test(tag);
  }
  // Bare tags: model ids only (no path traversal / absolute paths / Windows drives).
  if (
    tag.includes("\\") ||
    tag.startsWith("/") ||
    tag.startsWith("./") ||
    /^[a-zA-Z]:/.test(tag) ||
    /(^|\/)\.\.?(\/|$)/.test(tag)
  ) {
    return false;
  }
  return /^[\w./:@-]+$/.test(tag);
}
