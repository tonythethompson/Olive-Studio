import { describe, it, expect, beforeEach } from "vitest";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";

describe("playgroundStore", () => {
  beforeEach(() => {
    usePlaygroundStore.getState().resetPlayground();
  });

  it("setSlotA merges patches without clobbering other fields", () => {
    usePlaygroundStore.getState().setSlotA({ endpointUrl: "https://api.example.com/v1", type: "cloud" });
    usePlaygroundStore.getState().setSlotA({ apiKey: "secret" });
    const { slotA } = usePlaygroundStore.getState();
    expect(slotA.type).toBe("cloud");
    expect(slotA.endpointUrl).toBe("https://api.example.com/v1");
    expect(slotA.apiKey).toBe("secret");
  });

  it("resetPlayground clears Arena slots and playground sub-view", () => {
    usePlaygroundStore.getState().setActiveSubView("arena");
    usePlaygroundStore.getState().setSlotA({ type: "cloud", apiKey: "sk-test", endpointUrl: "https://x" });
    usePlaygroundStore.getState().setSlotB({ modelId: "gpt-test" });
    usePlaygroundStore.getState().resetPlayground();
    const store = usePlaygroundStore.getState();
    expect(store.activeSubView).toBe("browser-test");
    expect(store.slotA).toEqual({
      type: "local",
      file: null,
      tokenizerId: "",
      endpointUrl: "",
      apiKey: "",
      modelId: "",
    });
    expect(store.slotB).toEqual({
      type: "local",
      file: null,
      tokenizerId: "",
      endpointUrl: "",
      apiKey: "",
      modelId: "",
    });
  });
});
