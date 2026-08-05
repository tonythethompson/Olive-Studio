import { describe, expect, it } from "vitest";
import {
  getExecutionProviderFromRecipe,
  mapProviderToCatalogDevice,
} from "../oliveRecipeHub";

describe("oliveRecipeHub DirectML mapping", () => {
  it("maps directml/dml recipe EPs to DmlExecutionProvider", () => {
    const recipe = {
      systems: {
        local_system: {
          config: {
            accelerators: [{ execution_providers: ["DmlExecutionProvider"] }],
          },
        },
      },
    };
    expect(getExecutionProviderFromRecipe(recipe)).toBe("DmlExecutionProvider");
    expect(getExecutionProviderFromRecipe({
      systems: {
        local_system: {
          config: {
            accelerators: [{ execution_providers: ["directml"] }],
          },
        },
      },
    })).toBe("DmlExecutionProvider");
  });

  it("maps DmlExecutionProvider to DirectML catalog device", () => {
    expect(mapProviderToCatalogDevice("DmlExecutionProvider")).toBe("DirectML");
  });
});
