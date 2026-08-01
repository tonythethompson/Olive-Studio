import { describe, expect, it } from "vitest";
import { isKbStatusStale, kbFreshnessMs, KB_STALE_AFTER_MS } from "./useKbSync.ts";

describe("kbFreshnessMs", () => {
  it("prefers lastSync over lastUpdated", () => {
    expect(
      kbFreshnessMs({
        lastSync: "2026-07-31T12:00:00.000Z",
        lastUpdated: "2026-01-01",
      }),
    ).toBe(Date.parse("2026-07-31T12:00:00.000Z"));
  });

  it("treats date-only lastUpdated as end of UTC day", () => {
    expect(kbFreshnessMs({ lastUpdated: "2026-07-24" })).toBe(Date.parse("2026-07-24T23:59:59.999Z"));
  });
});

describe("isKbStatusStale", () => {
  it("is stale when no freshness stamp exists", () => {
    expect(isKbStatusStale({})).toBe(true);
    expect(isKbStatusStale(null)).toBe(true);
  });

  it("is fresh within the retention window", () => {
    const now = Date.parse("2026-07-31T18:00:00.000Z");
    expect(isKbStatusStale({ lastSync: "2026-07-31T12:00:00.000Z" }, now)).toBe(false);
  });

  it("is stale past the retention window", () => {
    const now = Date.parse("2026-07-31T18:00:00.000Z");
    const old = new Date(now - KB_STALE_AFTER_MS - 1000).toISOString();
    expect(isKbStatusStale({ lastSync: old }, now)).toBe(true);
  });
});
