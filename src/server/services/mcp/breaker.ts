/**
 * Circuit breaker for the Olive MCP server subprocess.
 *
 * When the MCP server keeps failing at the INFRASTRUCTURE level (spawn
 * failure, timeout, non-JSON output), subsequent tool calls short-circuit
 * instead of spawning a Python subprocess per call. Tool-level errors
 * (bad tool name, invalid args) never trip the breaker.
 *
 * Each admitted call receives an `epoch` token. `recordSuccess` /
 * `recordFailure` apply only when the token matches the breaker's current
 * epoch, so a subprocess that was admitted before the breaker opened (or
 * before a failed recovery probe) cannot overwrite newer state when it
 * completes late.
 */

export type McpCallAdmission = { epoch: number };

export type McpCircuitBreaker = {
  isOpen(): boolean;
  beforeCall(): McpCallAdmission | false;
  recordSuccess(epoch: number): void;
  recordFailure(epoch: number): void;
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
  let halfOpenProbeInFlight = false;
  /** Bumped when the breaker opens/reopens or a recovery probe succeeds. */
  let epoch = 0;

  function isOpen(): boolean {
    return openedAt !== null && now() - openedAt < cooldownMs;
  }

  return {
    isOpen,
    beforeCall(): McpCallAdmission | false {
      if (openedAt === null) return { epoch };
      if (isOpen()) return false;
      // Admit exactly one recovery probe after the cooldown expires.
      if (halfOpenProbeInFlight) return false;
      halfOpenProbeInFlight = true;
      return { epoch };
    },
    recordSuccess(admittedEpoch: number): void {
      if (admittedEpoch !== epoch) return;
      const wasRecoveryProbe = halfOpenProbeInFlight;
      failures = 0;
      openedAt = null;
      halfOpenProbeInFlight = false;
      if (wasRecoveryProbe) epoch += 1;
    },
    recordFailure(admittedEpoch: number): void {
      if (admittedEpoch !== epoch) return;
      halfOpenProbeInFlight = false;
      if (openedAt !== null) {
        // Re-open after a failed recovery probe (or an already-open call).
        openedAt = now();
        epoch += 1;
        return;
      }
      failures += 1;
      if (failures >= failureThreshold) {
        openedAt = now();
        epoch += 1;
      }
    },
    reset(): void {
      failures = 0;
      openedAt = null;
      halfOpenProbeInFlight = false;
      epoch += 1;
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
