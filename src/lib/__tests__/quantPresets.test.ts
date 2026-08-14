import { describe, it, expect } from "vitest";
import { importPresetsJSON } from "@/lib/quantPresets";

describe("importPresetsJSON", () => {
  it("imports a valid preset", () => {
    const json = JSON.stringify([{ label: "AWQ int4", fields: { quantMethod: "awq" } }]);
    const result = importPresetsJSON(json, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.importedPresets[0]?.fields.quantMethod).toBe("awq");
    }
  });

  it("rejects a preset whose fields are null instead of throwing", () => {
    const json = JSON.stringify([{ label: "Broken", fields: null }]);
    const result = importPresetsJSON(json, []);
    expect(result.ok).toBe(false);
  });
});
