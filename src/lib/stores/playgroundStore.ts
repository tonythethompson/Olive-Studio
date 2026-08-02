import { create } from "zustand";

/**
 * Session_Scoped store — deliberately not wrapped in Zustand `persist`.
 * `slotA.file` / `slotB.file` are `File` handles that serialize to `{}` and
 * would rehydrate as slots that look configured but hold no model.
 * If `activeSubView` is ever worth persisting, it must go through a
 * `partialize` allowlist, never whole-store persistence.
 */

export type PlaygroundSubView = "browser-test" | "benchmark" | "arena";

export interface ArenaSlotConfig {
  type: "local" | "cloud";
  // local
  file: File | null;
  // cloud
  endpointUrl: string;
  apiKey: string;
  modelId: string;
}

const defaultSlot = (): ArenaSlotConfig => ({
  type: "local",
  file: null,
  endpointUrl: "",
  apiKey: "",
  modelId: "",
});

interface PlaygroundStore {
  activeSubView: PlaygroundSubView;
  setActiveSubView: (v: PlaygroundSubView) => void;
  slotA: ArenaSlotConfig;
  slotB: ArenaSlotConfig;
  setSlotA: (patch: Partial<ArenaSlotConfig>) => void;
  setSlotB: (patch: Partial<ArenaSlotConfig>) => void;
}

export const usePlaygroundStore = create<PlaygroundStore>((set) => ({
  activeSubView: "browser-test",
  setActiveSubView: (v) => set({ activeSubView: v }),
  slotA: defaultSlot(),
  slotB: defaultSlot(),
  setSlotA: (patch) => set((s) => ({ slotA: { ...s.slotA, ...patch } })),
  setSlotB: (patch) => set((s) => ({ slotB: { ...s.slotB, ...patch } })),
}));
