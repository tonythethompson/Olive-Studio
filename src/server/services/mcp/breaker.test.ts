/**
 * Unit tests for the MCP circuit breaker with an injected fake clock.
 */
import { describe, it, expect } from "vitest";
import { createMcpCircuitBreaker } from "./breaker.ts";

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

describe("createMcpCircuitBreaker", () => {
  it("allows calls while closed", () => {
    const breaker = createMcpCircuitBreaker({ now: () => 0 });

    expect(breaker.beforeCall()).toBe(true);
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("opens after the failure threshold is reached", () => {
    const t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.beforeCall()).toBe(false);
    expect(breaker.status()).toEqual({ open: true, failures: FAILURE_THRESHOLD, openedAt: 0 });
  });

  it("does not increment failures when a call is short-circuited", () => {
    const t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();

    expect(breaker.beforeCall()).toBe(false);
    expect(breaker.status().failures).toBe(FAILURE_THRESHOLD);
  });

  it("allows a half-open probe once the cooldown has elapsed", () => {
    let t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();
    expect(breaker.beforeCall()).toBe(false);

    t += COOLDOWN_MS;
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.beforeCall()).toBe(true);
  });

  it("refreshes the cooldown when a half-open probe fails", () => {
    let t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();
    t += COOLDOWN_MS;

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.beforeCall()).toBe(false);

    // Still open right up to the refreshed cooldown boundary…
    t += COOLDOWN_MS - 1;
    expect(breaker.isOpen()).toBe(true);
    // …and closes once the full cooldown has elapsed again.
    t += 1;
    expect(breaker.isOpen()).toBe(false);
  });

  it("closes and zeroes failures on success", () => {
    const t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();
    breaker.recordSuccess();

    expect(breaker.isOpen()).toBe(false);
    expect(breaker.beforeCall()).toBe(true);
    expect(breaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("resets to closed with zero failures", () => {
    const t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure();
    breaker.reset();

    expect(breaker.isOpen()).toBe(false);
    expect(breaker.beforeCall()).toBe(true);
    expect(breaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("stays closed when recordSuccess is called while closed", () => {
    const breaker = createMcpCircuitBreaker({ now: () => 0 });

    breaker.recordSuccess();

    expect(breaker.isOpen()).toBe(false);
    expect(breaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });
});
