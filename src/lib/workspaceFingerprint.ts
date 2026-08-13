/**
 * Workspace fingerprint computation utility.
 *
 * Produces a deterministic SHA-256 hex digest of the UIState, excluding
 * transient fields that should not invalidate review results. Used for O(1)
 * staleness detection on review findings.
 *
 * @module workspaceFingerprint
 */

import type { UIState } from "@/types";
import { FINGERPRINT_EXCLUDED_KEYS } from "@/lib/types/findingTypes";

// ─── Deterministic Serialization ─────────────────────────────────────────────

/**
 * Recursively serializes a value with sorted object keys for deterministic output.
 * Matches JSON.stringify semantics: omits keys whose values are `undefined`.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// ─── Fingerprint Computation ─────────────────────────────────────────────────

/**
 * Computes a SHA-256 fingerprint of the UIState, excluding transient fields.
 *
 * The result is a 64-character lowercase hex string that changes only when
 * pipeline-relevant state is modified. Two deeply-equal UIState objects
 * (after transient field exclusion) always produce identical fingerprints.
 *
 * @param state - The full UIState from the pipeline store
 * @returns A 64-character lowercase hex SHA-256 digest
 */
export async function computeFingerprint(state: UIState): Promise<string> {
  // Build a copy excluding transient keys
  const filtered: Record<string, unknown> = {};
  const excludeSet = new Set<string>(FINGERPRINT_EXCLUDED_KEYS as string[]);

  for (const key of Object.keys(state)) {
    if (!excludeSet.has(key)) {
      filtered[key] = (state as unknown as Record<string, unknown>)[key];
    }
  }

  // File handles and metadata are transient, but selected names affect the recipe.
  if (Array.isArray(state.localFiles)) {
    filtered.localFileNames = state.localFiles.map((file) => file.name);
  }

  // Deterministic serialization with sorted keys
  const serialized = stableStringify(filtered);

  // SHA-256 via Web Crypto API (SubtleCrypto)
  const encoder = new TextEncoder();
  const data = encoder.encode(serialized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert ArrayBuffer to lowercase hex string
  const hashArray = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Synchronous deterministic serialization exposed for testing.
 * Returns the stable JSON string that would be hashed.
 *
 * @internal
 */
export function _serializeForFingerprint(state: UIState): string {
  const filtered: Record<string, unknown> = {};
  const excludeSet = new Set<string>(FINGERPRINT_EXCLUDED_KEYS as string[]);

  for (const key of Object.keys(state)) {
    if (!excludeSet.has(key)) {
      filtered[key] = (state as unknown as Record<string, unknown>)[key];
    }
  }

  // File handles and metadata are transient, but selected names affect the recipe.
  if (Array.isArray(state.localFiles)) {
    filtered.localFileNames = state.localFiles.map((file) => file.name);
  }

  return stableStringify(filtered);
}
