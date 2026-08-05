/**
 * Pure policy helpers for hardware probe ORT/DML/TRT detection.
 * Extracted for unit testing (system route probe loop).
 */

import { computeDirectMlHardwareReady } from "../../lib/hardwareProbe.ts";

/** Host-level DirectML readiness (Windows / DirectX 12 class), not EP registration. */
export function resolveDirectMlHardwareReady(input: { os?: string }): boolean {
  return Boolean(input.os && computeDirectMlHardwareReady({ os: input.os }));
}

/** Default-family ORT reports DmlExecutionProvider (install / load guidance). */
export function resolveDirectMlEpDetected(input: {
  defaultProviders?: string[];
}): boolean {
  return Boolean(input.defaultProviders?.includes("DmlExecutionProvider"));
}

/**
 * @deprecated Prefer resolveDirectMlEpDetected for EP / install-guidance callers.
 * Kept as an alias of EP detection for older call sites / tests.
 * Host readiness for detectedProviders listing uses resolveDirectMlHardwareReady.
 */
export function resolveDirectMlDetected(input: {
  defaultProviders?: string[];
}): boolean {
  return resolveDirectMlEpDetected(input);
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

/** Merge ORT provider lists with stable order: default → cuda → openvino → qnn → system. */
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

/** Prefer qnn-family python for QNN EP readiness notes. */
export function markQnnVenvLoadable(input: {
  isQnn: boolean;
  loadable: boolean;
}): boolean {
  return input.isQnn && input.loadable;
}
