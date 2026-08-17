/**
 * Extracts a human-readable error message from an unknown JSON error payload.
 *
 * Handles common shapes returned by APIs:
 *  - `{ error: "string" }`
 *  - `{ error: { message: "string" } }`
 *  - `{ message: "string" }`
 *  - plain string body
 *
 * @param payload - The parsed JSON body (or string) from an error response.
 * @param fallback - Fallback message when no known field is found.
 * @returns The extracted error string.
 */
export function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null) {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.error === "string") return rec.error;
    if (typeof rec.error === "object" && rec.error !== null) {
      const inner = rec.error as Record<string, unknown>;
      if (typeof inner.message === "string") return inner.message;
    }
    if (typeof rec.message === "string") return rec.message;
  }
  return fallback;
}
