import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import { getSelectedGpuVramGb, isGpuProvider } from "@/lib/vramEstimate";
import { IHVProvider, UIState } from "@/types";

export type MemoryOffloadMode = "gpu_only" | "auto";

const GPU_PROVIDERS: IHVProvider[] = [
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
];

export function isMemoryOffloadAvailable(state: UIState): boolean {
  return hasHuggingFaceModel(state) && isGpuProvider(state.ihvProvider);
}

export function hasHuggingFaceModel(state: UIState): boolean {
  return state.modelSource === "huggingface" && Boolean(state.hfModelId.trim());
}

export function isMemoryOffloadActive(state: UIState): boolean {
  return state.memoryOffload === "auto" && isMemoryOffloadAvailable(state);
}

/** GiB strings for Hugging Face max_memory (device 0 + cpu). */
export function buildMaxMemoryMap(gpuVramGb: number, systemRamGb: number): Record<string, string> {
  const gpuBudget = Math.max(1, Math.floor(gpuVramGb * 0.9));
  const cpuBudget = Math.max(4, Math.floor(systemRamGb * 0.75));
  return {
    "0": `${gpuBudget}GiB`,
    cpu: `${cpuBudget}GiB`,
  };
}

export function resolveMemoryBudgets(
  provider: IHVProvider,
  probe: HardwareProbeResult | null | undefined,
  systemRamGb?: number | null,
): { gpuVramGb: number; systemRamGb: number } {
  const probedGpu = getSelectedGpuVramGb(probe ?? null, provider);
  const probedRam = probe?.platform.systemRamGb ?? systemRamGb ?? null;

  return {
    gpuVramGb: probedGpu ?? 12,
    systemRamGb: probedRam ?? 32,
  };
}

export function buildHfLoadKwargs(
  provider: IHVProvider,
  probe: HardwareProbeResult | null | undefined,
  systemRamGb?: number | null,
): Record<string, unknown> {
  const { gpuVramGb, systemRamGb: ramGb } = resolveMemoryBudgets(provider, probe, systemRamGb);

  return {
    device_map: "auto",
    low_cpu_mem_usage: true,
    max_memory: buildMaxMemoryMap(gpuVramGb, ramGb),
  };
}

export function buildPeftOffloadConfig(): Record<string, unknown> {
  return {
    device_map: "auto",
    ephemeral_gpu_offload: true,
  };
}

export function recipeUsesMemoryOffload(recipe: unknown): boolean {
  if (!recipe || typeof recipe !== "object") return false;
  const inputModel = (recipe as Record<string, unknown>).input_model;
  if (!inputModel || typeof inputModel !== "object") return false;
  const config = (inputModel as Record<string, unknown>).config;
  if (!config || typeof config !== "object") return false;
  const loadKwargs = (config as Record<string, unknown>).load_kwargs;
  if (!loadKwargs || typeof loadKwargs !== "object") return false;
  return (loadKwargs as Record<string, unknown>).device_map === "auto";
}

export function memoryOffloadFromRecipe(parsed: unknown): MemoryOffloadMode | undefined {
  return recipeUsesMemoryOffload(parsed) ? "auto" : undefined;
}

export function gpuProvidersUsingOffload(): IHVProvider[] {
  return GPU_PROVIDERS;
}

/** Fill max_memory from live probe before olive run (recipe may have been built without probe). */
export function enrichRecipeMemoryOffloadForRun(
  recipe: Record<string, unknown>,
  gpuVramGb: number,
  systemRamGb: number,
): Record<string, unknown> {
  if (!recipeUsesMemoryOffload(recipe)) {
    return recipe;
  }

  const next = structuredClone(recipe) as Record<string, unknown>;
  const inputModel = next.input_model as Record<string, unknown> | undefined;
  const config = inputModel?.config as Record<string, unknown> | undefined;
  const loadKwargs = config?.load_kwargs as Record<string, unknown> | undefined;

  if (loadKwargs?.device_map === "auto") {
    loadKwargs.max_memory = buildMaxMemoryMap(gpuVramGb, systemRamGb);
  }

  return next;
}
