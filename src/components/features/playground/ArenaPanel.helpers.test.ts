/**
 * Focused unit coverage for ArenaPanel pure helpers (component test tier).
 */
import { describe, it, expect } from "vitest";
import { clearRunResults, computeElapsed, getFasterSlot } from "./ArenaPanel";

describe("computeElapsed", () => {
  it("returns the positive delta between performance timestamps", () => {
    expect(computeElapsed(100, 250)).toBe(150);
    expect(computeElapsed(0, 0)).toBe(0);
  });
});

describe("getFasterSlot", () => {
  it("picks the lower elapsed time", () => {
    expect(getFasterSlot(10, 20)).toBe("a");
    expect(getFasterSlot(30, 12)).toBe("b");
  });

  it("returns tie when elapsed times are equal", () => {
    expect(getFasterSlot(15, 15)).toBe("tie");
    expect(getFasterSlot(0, 0)).toBe("tie");
  });
});

describe("clearRunResults", () => {
  it("resets both result objects to the idle initial state", () => {
    expect(clearRunResults()).toEqual({
      resultA: { output: "", elapsedMs: 0, status: "idle" },
      resultB: { output: "", elapsedMs: 0, status: "idle" },
    });
  });
});
