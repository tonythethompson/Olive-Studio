/**
 * Single-flight graceful shutdown helper.
 *
 * SIGINT/SIGTERM can arrive repeatedly while cleanup is running (a second
 * Ctrl+C, a service-manager SIGTERM, etc.). Each new signal must not start a
 * second cleanup — that could exit the parent before the first shutdown of
 * child processes finishes. Only the first invocation runs cleanup and calls
 * `process.exit`; subsequent calls return the same in-flight promise.
 */

/**
 * Creates a graceful-shutdown runner that is idempotent while in flight.
 *
 * @param cleanup - Callbacks that stop child processes (e.g. GenAI sidecar, MCP client).
 * @returns An async shutdown runner keyed by the signal that triggered it.
 */
export function createSingleFlightShutdown(cleanup: Array<() => Promise<unknown>>) {
  let shutdownPromise: Promise<void> | null = null;
  return (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      // eslint-disable-next-line no-console -- intentional shutdown logging
      console.log(`\n[${signal}] Shutting down.`);
      await Promise.allSettled(cleanup.map((stop) => stop()));
      process.exit(0);
    })();

    return shutdownPromise;
  };
}
