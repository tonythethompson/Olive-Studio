/**
 * Circuit breaker for the Olive MCP server subprocess.
 *
 * When the MCP server keeps failing at the INFRASTRUCTURE level (spawn
 * failure, timeout, non-JSON output), subsequent tool calls short-circuit
 * instead of spawning a Python subprocess per call. Tool-level errors
 * (bad tool name, invalid args) never trip the breaker.
 */

export type McpCircuitBreaker = {
  isOpen(): boolean;
  beforeCall(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
  reset(): void;
  status(): { open: boolean; failures: number; openedAt: number | null };
};

/**
 * Creates an independent circuit breaker with injectable clock and thresholds.
 *
 * @param options - failureThreshold (default 3), cooldownMs (default 30_000), now (default Date.now)
 * @returns A circuit breaker sharing no state with any other instance
 */
export function createMcpCircuitBreaker(
  options: { failureThreshold?: number; cooldownMs?: number; now?: () => number } = {},
): McpCircuitBreaker {
  const failureThreshold = options.failureThreshold ?? 3;
  const cooldownMs = options.cooldownMs ?? 30_000;
  // Resolve Date.now through the global at call time so fake timers (vitest)
  // can control the default clock; explicit `now` injectables are unaffected.
  const now = options.now ?? (() => Date.now());

  let failures = 0;
  let openedAt: number | null = null;

  function isOpen(): boolean {
    return openedAt !== null && now() - openedAt < cooldownMs;
  }

  return {
    isOpen,
    beforeCall(): boolean {
      return !isOpen();
    },
    recordSuccess(): void {
      failures = 0;
      openedAt = null;
    },
    recordFailure(): void {
      if (openedAt !== null) {
        // Already open — refresh the cooldown but never grow `failures` past the trip point.
        openedAt = now();
        return;
      }
      failures += 1;
      if (failures >= failureThreshold) {
        openedAt = now();
      }
    },
    reset(): void {
      failures = 0;
      openedAt = null;
    },
    status(): { open: boolean; failures: number; openedAt: number | null } {
      return { open: isOpen(), failures, openedAt };
    },
  };
}

/** Process-wide breaker shared by the MCP tool client. */
const mcpBreaker = createMcpCircuitBreaker();

/** Resets the process-wide MCP breaker (used by tests and manual recovery). */
export function resetMcpBreaker(): void {
  mcpBreaker.reset();
}

export default mcpBreaker;
