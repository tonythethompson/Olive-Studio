import { create } from "zustand";
import { UIState } from "@/types";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";

const defaultState: UIState = {
  modelSource: "huggingface",
  localFiles: [],
  azureModelPath: "",
  hfModelId: "meta-llama/Meta-Llama-3-8B",
  hfTask: "",
  hfDataset: "",
  ihvProvider: "CPUExecutionProvider",
  memoryOffload: "gpu_only",
  cudaVersion: "auto",
  cacheDir: "",
  azureStr: "",
  distributedCaching: false,
  activeJobId: null,
  passes: { ...DEFAULT_PASSES },
};

export type PlaygroundSubView = "browser-test" | "benchmark" | "arena";
export interface ArenaSlotConfig {
  type: "local" | "cloud";
  file: File | null;
  endpointUrl: string;
  apiKey: string;
  modelId: string;
}

const defaultArenaSlot = (): ArenaSlotConfig => ({ type: "local", file: null, endpointUrl: "", apiKey: "", modelId: "" });

interface PipelineStore {
  state: UIState;
  activeSubView: PlaygroundSubView;
  setActiveSubView: (v: PlaygroundSubView) => void;
  slotA: ArenaSlotConfig;
  slotB: ArenaSlotConfig;
  setSlotA: (patch: Partial<ArenaSlotConfig>) => void;
  setSlotB: (patch: Partial<ArenaSlotConfig>) => void;
  setState: (partial: Partial<UIState>) => void;
  /** Replace the entire state (used by recipe import / preset load). */
  replaceState: (next: UIState) => void;
  /** Reset to defaults. */
  resetState: () => void;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  state: defaultState,
  activeSubView: "browser-test",
  setActiveSubView: (v) => set({ activeSubView: v }),
  slotA: defaultArenaSlot(),
  slotB: defaultArenaSlot(),
  setSlotA: (patch) => set((s) => ({ slotA: { ...s.slotA, ...patch } })),
  setSlotB: (patch) => set((s) => ({ slotB: { ...s.slotB, ...patch } })),

  setState: (partial) =>
    set((store) => ({
      state: commitUiStateUpdate(store.state, partial),
    })),

  replaceState: (next) =>
    set({
      state: commitUiStateUpdate(next, {}),
    }),

  resetState: () =>
    set({
      state: commitUiStateUpdate(defaultState, {}),
      activeSubView: "browser-test",
      slotA: defaultArenaSlot(),
      slotB: defaultArenaSlot(),
    }),
}));

/**
 * Provides pipeline state and a partial state update function through the store.
 *
 * @returns The current pipeline state and a function for applying partial updates
 */
export function usePipelineState() {
  const state = usePipelineStore((s) => s.state);
  const setState = usePipelineStore((s) => s.setState);
  return { state, setState };
}
