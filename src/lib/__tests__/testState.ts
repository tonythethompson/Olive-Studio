import type { UIState, IHVProvider } from "@/types";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";

export function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider" as IHVProvider,
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: { ...DEFAULT_PASSES, ...overrides?.passes },
  } as UIState;
}
