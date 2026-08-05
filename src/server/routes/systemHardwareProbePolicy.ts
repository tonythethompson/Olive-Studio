/**
 * Pure policy helpers for hardware probe ORT/DML/TRT detection.
 * Extracted for unit testing (system route probe loop).
 */

export function resolveDirectMlDetected(input: {
  defaultProviders?: string[];
  systemProviders?: string[];
}): boolean {
  return Boolean(input.defaultProviders?.includes("DmlExecutionProvider"));
}

export function markTensorRtVenvLoadable(input: {
  isCuda: boolean;
  isDefault: boolean;
  cudaPythonExists: boolean;
  loadable: boolean;
}): boolean {
  return (
    input.loadable && (input.isCuda || (!input.cudaPythonExists && input.isDefault))
  );
}

/** Merge ORT provider lists with stable order: default → cuda → openvino → system. */
export function mergeOrtProvidersForDisplay(
  ...lists: Array<string[] | undefined>
): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const provider of list) {
      if (!seen.has(provider)) {
        seen.add(provider);
        out.push(provider);
      }
    }
  }
  return out.length > 0 ? out : undefined;
}
