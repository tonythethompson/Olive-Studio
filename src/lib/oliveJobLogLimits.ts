/**
 * Shared Olive job log retention limits.
 *
 * Server SSE replay can emit every buffered line on reconnect. Clients that
 * dedupe via a delivered-prefix window must retain at least
 * {@link JOB_LOG_TRIM_WATERMARK} entries so a pre-trim buffer cannot defeat
 * replay matching.
 */

/** Retained log lines after trim (truncation notice uses this). */
export const MAX_JOB_LOG_LINES = 1_000;

/** Peak buffer size before trim; SSE may replay this many lines on reconnect. */
export const JOB_LOG_TRIM_WATERMARK = MAX_JOB_LOG_LINES + 250;
