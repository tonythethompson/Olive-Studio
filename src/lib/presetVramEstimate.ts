import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import {
  compareVramFit,
  estimateVramRequirement,
  formatMemoryGb,
  getHybridMemoryPoolGb,
  getSelectedGpuVramGb,
} from "@/lib/vramEstimate";
import { IHVProvider, UIState } from "@/types";

function catalogDeviceToProvider(device: string): IHVProvider {
  switch (device) {
    case "CUDA":
    case "DirectML":
      return "CUDAExecutionProvider";
    case "TensorRT":
      return "TensorrtExecutionProvider";
    case "OpenVINO":
      return "OpenVINOExecutionProvider";
    case "QNN":
      return "QNNExecutionProvider";
    case "CPU":
    default:
      return "CPUExecutionProvider";
  }
}

/** Model slug from olive-recipes folder name (e.g. allenai-Olmo-3-7B-Instruct). */
export function inferCatalogModelId(item: RecipeCatalogItem): string {
  const slug = item.repoPath.split("/")[0] ?? item.name;
  return slug.replace(/_/g, "-");
}

export function inferPassesFromCatalogItem(item: RecipeCatalogItem): UIState["passes"] {
  const text = `${item.repoPath} ${item.name} ${item.description}`.toLowerCase();
  const passes: UIState["passes"] = { ...DEFAULT_PASSES };

  if (text.includes("int4")) {
    passes.quantization = true;
    passes.quantPrecision = "int4";
    passes.quantMethod = "ptq";
  } else if (text.includes("int8") || text.includes("/quant/") || text.includes("_quant")) {
    passes.quantization = true;
    passes.quantPrecision = "int8";
    passes.quantMethod = "ptq";
  }

  if (text.includes("awq")) {
    passes.quantization = true;
    passes.quantMethod = "awq";
  }
  if (text.includes("qat")) {
    passes.quantization = true;
    passes.quantMethod = "qat";
  }

  if (text.includes("fp16") || text.includes("float16") || text.includes("bf16")) {
    passes.conversionInputTargetTypes = "float16";
  } else if (text.includes("fp32") || text.includes("float32")) {
    passes.conversionInputTargetTypes = "float32";
  } else if (
    /llama|mistral|qwen|deepseek|phi|gemma|instruct|coder/i.test(
      `${item.repoPath} ${inferCatalogModelId(item)}`,
    )
  ) {
    // HF LLMs are typically loaded in fp16/bf16 — not fp32.
    passes.conversionInputTargetTypes = "float16";
  }

  if (text.includes("lora") || text.includes("peft") || text.includes("qlora")) {
    passes.peft = true;
    passes.peftMethod = text.includes("qlora") ? "qlora" : "lora";
  }
  if (text.includes("prun")) {
    passes.pruning = true;
  }
  if (text.includes("split")) {
    passes.splitting = true;
  }

  return passes;
}

export function buildUiStateSketchFromCatalogItem(item: RecipeCatalogItem): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: inferCatalogModelId(item),
    hfDataset: "",
    ihvProvider: catalogDeviceToProvider(item.device),
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    passes: inferPassesFromCatalogItem(item),
  };
}

export interface PresetVramEstimate {
  inferenceGb: number;
  peakRunGb: number;
  usesGpu: boolean;
  summaryLine: string;
  fitHint: string | null;
}

export function estimateVramForCatalogPreset(
  item: RecipeCatalogItem,
  probe?: HardwareProbeResult | null,
): PresetVramEstimate {
  const sketch = buildUiStateSketchFromCatalogItem(item);
  const estimate = estimateVramRequirement(sketch);
  const availableGb = getSelectedGpuVramGb(probe ?? null, sketch.ihvProvider);
  const systemRamGb = probe?.platform.systemRamGb ?? null;

  const beforeLabel = estimate.usesGpu ? "VRAM" : "RAM";
  const peakLabel = estimate.usesGpu ? "peak VRAM" : "peak RAM";

  let fitHint: string | null = null;
  if (estimate.usesGpu && availableGb != null) {
    const inferenceFit = compareVramFit(estimate.inferenceGb, availableGb);
    const poolGb =
      systemRamGb != null ? getHybridMemoryPoolGb(availableGb, systemRamGb) : availableGb;
    const runFit = compareVramFit(estimate.peakRunGb, poolGb);

    if (runFit === "insufficient") {
      fitHint = "Peak run may need hybrid offload";
    } else if (runFit === "tight" || inferenceFit === "tight") {
      fitHint = "Tight on this GPU";
    } else if (inferenceFit === "insufficient") {
      fitHint = "Deployed model may exceed GPU VRAM";
    }
  }

  const summaryLine = `~${formatMemoryGb(estimate.sourceWeightGb)} ${beforeLabel} model · ~${formatMemoryGb(estimate.peakRunGb)} ${peakLabel} during run`;

  return {
    inferenceGb: estimate.inferenceGb,
    peakRunGb: estimate.peakRunGb,
    usesGpu: estimate.usesGpu,
    summaryLine,
    fitHint,
  };
}
