import { create } from "zustand";
import { persist } from "zustand/middleware";
import { UIState } from "@/types";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";

const STORAGE_KEY = "olive:pipeline-state";

/**
 * Pure factory for default pipeline UI state.
 * Returns a fresh object each call (no shared mutable singleton).
 */
export function createDefaultPipelineState(): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "",
    hfTask: "",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider",
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    passes: { ...DEFAULT_PASSES },
  };
}

interface PipelineStore {
  state: UIState;
  setState: (partial: Partial<UIState>) => void;
  /** Replace the entire state (used by recipe import / preset load). */
  replaceState: (next: UIState) => void;
  /** Reset to defaults. */
  resetState: () => void;
}

export const usePipelineStore = create<PipelineStore>()(
  persist(
    (set) => ({
      state: createDefaultPipelineState(),

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
          state: commitUiStateUpdate(createDefaultPipelineState(), {}),
        }),
    }),
    {
      name: STORAGE_KEY,
      // Only persist the pipeline state, not the store methods.
      // Strip credentials and runtime-only fields before writing to localStorage.
      partialize: (store) => ({
        state: {
          ...store.state,
          azureStr: "",
          activeJobId: null,
          localFiles: [],
        },
      }),
      // On rehydration, run coercion to catch stale/incompatible persisted state.
      merge: (persisted, current) => {
        const saved = persisted as { state?: Partial<UIState> } | undefined;
        if (!saved?.state) return current;
        // Merge persisted state with defaults (handles new fields added after save).
        const merged: UIState = {
          ...createDefaultPipelineState(),
          ...saved.state,
          passes: { ...DEFAULT_PASSES, ...(saved.state.passes ?? {}) },
          // Never persist runtime-only or credential fields.
          activeJobId: null,
          localFiles: [],
          azureStr: "",
        };
        return { ...current, state: commitUiStateUpdate(merged, {}) };
      },
    },
  ),
);

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
