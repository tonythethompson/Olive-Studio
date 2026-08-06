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

    expect(breaker.beforeCall()).toEqual({ epoch: 0 });
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

    breaker.recordFailure(0);
    breaker.recordFailure(0);
    expect(breaker.isOpen()).toBe(false);

    breaker.recordFailure(0);
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

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure(0);

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

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure(0);
    expect(breaker.beforeCall()).toBe(false);

    t += COOLDOWN_MS;
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.beforeCall()).toEqual({ epoch: 1 });
  });

  it("refreshes the cooldown when a half-open probe fails", () => {
    let t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure(0);
    t += COOLDOWN_MS;

    breaker.recordFailure(1);
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.beforeCall()).toBe(false);

    t += COOLDOWN_MS - 1;
    expect(breaker.isOpen()).toBe(true);
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

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure(0);
    breaker.recordSuccess(1);

    expect(breaker.isOpen()).toBe(false);
    expect(breaker.beforeCall()).toEqual({ epoch: 1 });
    expect(breaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("resets to closed with zero failures", () => {
    const t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) breaker.recordFailure(0);
    breaker.reset();

    expect(breaker.isOpen()).toBe(false);
    expect(breaker.beforeCall()).toEqual({ epoch: 2 });
    expect(breaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("stays closed when recordSuccess is called while closed", () => {
    const breaker = createMcpCircuitBreaker({ now: () => 0 });

    breaker.recordSuccess(0);

    expect(breaker.isOpen()).toBe(false);
    expect(breaker.status()).toEqual({ open: false, failures: 0, openedAt: null });
  });

  it("ignores stale completions from before the breaker opened", () => {
    const breaker = createMcpCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: COOLDOWN_MS,
      now: () => 0,
    });

    const first = breaker.beforeCall();
    expect(first).toEqual({ epoch: 0 });

    breaker.recordFailure(0);
    breaker.recordFailure(0);
    expect(breaker.isOpen()).toBe(true);

    // Late success from the pre-open admission must not close the breaker.
    breaker.recordSuccess(first!.epoch);
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.beforeCall()).toBe(false);
  });

  it("ignores stale success after a failed recovery probe", () => {
    let t = 0;
    const breaker = createMcpCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: COOLDOWN_MS,
      now: () => t,
    });

    const stale = breaker.beforeCall();
    breaker.recordFailure(stale!.epoch);
    expect(breaker.isOpen()).toBe(true);

    t += COOLDOWN_MS;
    const probe = breaker.beforeCall();
    expect(probe).toEqual({ epoch: 1 });
    breaker.recordFailure(probe!.epoch);
    expect(breaker.isOpen()).toBe(true);

    // Stale success from the original closed-state call must not clear the breaker.
    breaker.recordSuccess(stale!.epoch);
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.beforeCall()).toBe(false);
  });
});
