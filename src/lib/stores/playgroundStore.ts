import { create } from "zustand";

/**
 * Session-scoped Playground UI state (sub-view + Arena slots).
 *
 * Intentionally separate from `pipelineStore`: Playground holds non-serializable
 * `File` handles and cloud credential fields that must not participate in recipe
 * import / replace / pipeline persistence.
 */
export type PlaygroundSubView = "browser-test" | "benchmark" | "arena";

export interface ArenaSlotConfig {
  type: "local" | "cloud";
  file: File | null;
  /** Optional HF tokenizer id for local NLP models (transformers.js). */
  tokenizerId: string;
  endpointUrl: string;
  apiKey: string;
  modelId: string;
}

const defaultArenaSlot = (): ArenaSlotConfig => ({
  type: "local",
  file: null,
  tokenizerId: "",
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
  /** Reset session-scoped Playground fields (does not touch pipeline state). */
  resetPlayground: () => void;
}

export const usePlaygroundStore = create<PlaygroundStore>((set) => ({
  activeSubView: "browser-test",
  setActiveSubView: (v) => set({ activeSubView: v }),
  slotA: defaultArenaSlot(),
  slotB: defaultArenaSlot(),
  setSlotA: (patch) => set((s) => ({ slotA: { ...s.slotA, ...patch } })),
  setSlotB: (patch) => set((s) => ({ slotB: { ...s.slotB, ...patch } })),
  resetPlayground: () =>
    set({
      activeSubView: "browser-test",
      slotA: defaultArenaSlot(),
      slotB: defaultArenaSlot(),
    }),
}));
