/**
 * Batch comparison validation utilities.
 * Validates job count constraints and parses MCP `compare_results` tool output
 * into the typed `CompareResultsOutput` structure.
 */

import type {
  CompareResultEntry,
  CompareResultsOutput,
  ExcludedJob,
} from "@/lib/types/agentTypes";

/**
 * Validates that the job count is within the accepted range for batch comparison.
 * The MCP `compare_results` tool requires between 2 and 10 jobs inclusive.
 *
 * @param count - Number of job records to compare
 * @returns true if count is in [2, 10], false otherwise
 */
export function validateJobCount(count: number): boolean {
  return Number.isInteger(count) && count >= 2 && count <= 10;
}

/**
 * Validates that a value is a string.
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Validates that a value is a number or null.
 */
function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Validates a single result entry from the MCP compare_results output.
 */
function flattenCompareEntry(entry: unknown): CompareResultEntry | null {
  if (entry === null || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  if (!isString(obj.job_id)) return null;
  if (typeof obj.score !== "number" || !Number.isFinite(obj.score)) return null;

  const metrics =
    obj.metrics !== null && typeof obj.metrics === "object" && !Array.isArray(obj.metrics)
      ? (obj.metrics as Record<string, unknown>)
      : obj;

  if (
    !isNumberOrNull(metrics.latency_ms) ||
    !isNumberOrNull(metrics.model_size_mb) ||
    !isNumberOrNull(metrics.accuracy)
  ) {
    return null;
  }

  return {
    job_id: obj.job_id,
    latency_ms: metrics.latency_ms,
    model_size_mb: metrics.model_size_mb,
    accuracy: metrics.accuracy,
    score: obj.score,
  };
}

/**
 * Validates a single excluded job entry.
 */
function isValidExcludedJob(entry: unknown): entry is ExcludedJob {
  if (entry === null || typeof entry !== "object") return false;
  const obj = entry as Record<string, unknown>;
  return isString(obj.job_id) && isString(obj.reason);
}

/**
 * Parses and validates raw MCP `compare_results` tool output into a typed
 * `CompareResultsOutput`. Returns null if the structure is invalid.
 *
 * Validates:
 * - `results` is an array of valid CompareResultEntry objects
 * - `winner` is a string or null
 * - `reasoning` is a string
 * - `excluded_jobs` is an array of valid ExcludedJob objects
 *
 * @param raw - The raw untyped response from the MCP tool
 * @returns Typed CompareResultsOutput or null if validation fails
 */
export function parseMcpCompareOutput(
  raw: Record<string, unknown>
): CompareResultsOutput | null {
  const rows = Array.isArray(raw.comparison)
    ? raw.comparison
    : Array.isArray(raw.results)
      ? raw.results
      : null;
  if (!rows) return null;
  const results: CompareResultEntry[] = [];
  for (const row of rows) {
    const parsed = flattenCompareEntry(row);
    if (!parsed) return null;
    results.push(parsed);
  }

  // Validate `winner` is string or null
  if (raw.winner !== null && !isString(raw.winner)) return null;

  // Validate `reasoning` is a string
  if (!isString(raw.reasoning)) return null;

  // Validate `excluded_jobs` is an array of valid entries
  if (!Array.isArray(raw.excluded_jobs)) return null;
  if (!raw.excluded_jobs.every(isValidExcludedJob)) return null;

  return {
    results,
    winner: raw.winner as string | null,
    reasoning: raw.reasoning as string,
    excluded_jobs: raw.excluded_jobs as ExcludedJob[],
  };
}
