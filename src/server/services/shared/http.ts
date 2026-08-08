/**
 * Shared HTTP helpers.
 *
 * `fetchWithTimeout` wraps the global `fetch` with an AbortSignal so a slow or
 * hung upstream can never pin a request open indefinitely. Use it for all
 * outbound provider/API calls.
 */

/** Default timeout for outbound AI/provider calls (generous — model latency). */
export const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

/**
 * `fetch` with an abort-based timeout. Merges any caller-provided `signal`
 * with the timeout signal so either can abort the request.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}
