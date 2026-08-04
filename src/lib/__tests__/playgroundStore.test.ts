import { describe, it, expect, beforeEach } from "vitest";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";

describe("playgroundStore", () => {
  beforeEach(() => {
    usePlaygroundStore.getState().resetPlayground();
  });

  it("defaults to browser-test with empty local slots", () => {
    const store = usePlaygroundStore.getState();
    expect(store.activeSubView).toBe("browser-test");
    expect(store.slotA.type).toBe("local");
    expect(store.slotA.file).toBeNull();
    expect(store.slotB.type).toBe("local");
    expect(store.slotB.file).toBeNull();
  });

  it("setActiveSubView updates the active playground sub-view", () => {
    usePlaygroundStore.getState().setActiveSubView("arena");
    expect(usePlaygroundStore.getState().activeSubView).toBe("arena");
    usePlaygroundStore.getState().setActiveSubView("benchmark");
    expect(usePlaygroundStore.getState().activeSubView).toBe("benchmark");
  });

  it("setSlotB patches independently of slotA", () => {
    usePlaygroundStore.getState().setSlotA({ type: "cloud", endpointUrl: "https://a.example" });
    usePlaygroundStore.getState().setSlotB({ modelId: "model-b", type: "cloud" });
    const { slotA, slotB } = usePlaygroundStore.getState();
    expect(slotA.endpointUrl).toBe("https://a.example");
    expect(slotA.modelId).toBe("");
    expect(slotB.modelId).toBe("model-b");
    expect(slotB.endpointUrl).toBe("");
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
