/**
 * Shared streaming helpers for AI routes (NDJSON progress streams and
 * client-disconnect tracking).
 */

export function beginNdjsonStream(res: import("express").Response): (evt: Record<string, unknown>) => void {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  return (evt) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(evt)}\n`);
  };
}

export function endNdjson(res: import("express").Response, final: Record<string, unknown>): void {
  if (!res.writableEnded) {
    res.write(`${JSON.stringify(final)}\n`);
    res.end();
  }
}

/**
 * Track client disconnect for long-running NDJSON streams.
 * Does not cancel shared ensure* single-flight work used by other requests.
 */
export function trackStreamClient(
  req: import("express").Request,
  res: import("express").Response,
): {
  disconnected: () => boolean;
  signal: AbortSignal;
  endOnce: () => void;
} {
  const ac = new AbortController();
  let ended = false;
  const onGone = () => {
    if (!ac.signal.aborted) ac.abort();
  };
  req.on("close", onGone);
  req.on("aborted", onGone);
  return {
    disconnected: () => ac.signal.aborted || res.writableEnded,
    signal: ac.signal,
    endOnce: () => {
      if (ended || res.writableEnded) return;
      ended = true;
      if (!res.writableEnded) res.end();
    },
  };
}

/** Begin NDJSON stream for local model pull progress (client parses line-delimited JSON). */
export function beginPullSse(res: import("express").Response) {
  return beginNdjsonStream(res);
}
