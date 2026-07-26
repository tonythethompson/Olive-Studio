import { create } from "zustand";
import { UIState } from "@/types";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";

const defaultState: UIState = {
  modelSource: "huggingface",
  localFiles: [],
  azureModelPath: "",
  hfModelId: "meta-llama/Meta-Llama-3-8B",
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

interface PipelineStore {
  state: UIState;
  setState: (partial: Partial<UIState>) => void;
  /** Replace the entire state (used by recipe import / preset load). */
  replaceState: (next: UIState) => void;
  /** Reset to defaults. */
  resetState: () => void;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  state: defaultState,

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
    }),
}));

/**
 * Compatibility shim hook — returns `{ state, setState }` matching the
 * existing prop interface. Components being migrated can call this instead
 * of receiving props, until all prop-drilling is removed in Phase D.
 */
export function usePipelineState() {
  const state = usePipelineStore((s) => s.state);
  const setState = usePipelineStore((s) => s.setState);
  return { state, setState };
}
