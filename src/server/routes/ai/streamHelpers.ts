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
 * Pass `guard.signal` to `ensure*` so disconnect removes this client as a waiter.
 * Shared setup aborts only when no waiters remain (see ensure* JSDoc).
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
  // `req`'s 'close' fires once the request body finishes being read (already
  // happened by the time we get here — the JSON body is parsed) and does not
  // reliably fire again when the client aborts later. `res`'s 'close' is the
  // event Node actually fires when the underlying connection drops before a
  // streaming response finishes, which is what a cancelled fetch looks like
  // from the server's side. Without it, a cancelled download's child process
  // (and the busy-tag lock built on `guard.signal`) never gets released.
  req.on("aborted", onGone);
  res.on("close", onGone);
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
