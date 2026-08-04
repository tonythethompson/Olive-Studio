import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import {
  compareVramFit,
  estimateVramRequirement,
  formatMemoryGb,
  getHybridMemoryPoolGb,
  getPrimaryGpuVramGb,
  getSelectedGpuVramGb,
} from "@/lib/vramEstimate";
import { IHVProvider, UIState } from "@/types";

function catalogDeviceToProvider(device: string): IHVProvider {
  switch (device) {
    case "CUDA":
      return "CUDAExecutionProvider";
    case "DirectML":
      return "DmlExecutionProvider";
    case "TensorRT":
      return "TensorrtExecutionProvider";
    case "TensorRT RTX":
      return "NvTensorRTRTXExecutionProvider";
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

/**
 * Estimates deployed-model and peak-run memory requirements for a catalog preset.
 *
 * @param item - The catalog item whose preset memory usage should be estimated
 * @param probe - Optional hardware information used to assess memory fit
 * @returns Memory estimates, GPU usage, a formatted summary, and an optional fit warning
 */
export function estimateVramForCatalogPreset(
  item: RecipeCatalogItem,
  probe?: HardwareProbeResult | null,
): PresetVramEstimate {
  const sketch = buildUiStateSketchFromCatalogItem(item);
  const estimate = estimateVramRequirement(sketch);
  // Always use the machine's GPU when present so CPU recipes still warn when the
  // model footprint will not fit the card (catalog device does not hide VRAM risk).
  const availableGb = estimate.usesGpu
    ? (getSelectedGpuVramGb(probe ?? null, sketch.ihvProvider) ?? getPrimaryGpuVramGb(probe ?? null))
    : (getPrimaryGpuVramGb(probe ?? null) ?? getSelectedGpuVramGb(probe ?? null, sketch.ihvProvider));
  const systemRamGb = probe?.platform.systemRamGb ?? null;

  const beforeLabel = estimate.usesGpu ? "VRAM" : "RAM";
  const peakLabel = estimate.usesGpu ? "peak VRAM" : "peak RAM";

  let fitHint: string | null = null;
  if (estimate.usesGpu && availableGb != null) {
    const inferenceFit = compareVramFit(estimate.inferenceGb, availableGb);
    if (inferenceFit === "insufficient") {
      fitHint = "Deployed model may exceed GPU VRAM";
    } else {
      // Peak must be judged against GPU VRAM first. Comparing only to the hybrid
      // GPU+RAM pool hid warnings when Olive peak exceeded the card but fit in RAM.
      const peakOnGpuFit = compareVramFit(estimate.peakRunGb, availableGb);
      const poolGb = systemRamGb != null ? getHybridMemoryPoolGb(availableGb, systemRamGb) : availableGb;
      const peakOnPoolFit = compareVramFit(estimate.peakRunGb, poolGb);

      if (peakOnGpuFit === "insufficient") {
        fitHint =
          peakOnPoolFit === "insufficient"
            ? "Peak run may need hybrid offload"
            : "Peak Olive run may exceed GPU VRAM";
      } else if (inferenceFit === "tight" || peakOnGpuFit === "tight") {
        fitHint = "Tight on this GPU";
      } else if (peakOnPoolFit === "insufficient") {
        fitHint = "Peak run may need hybrid offload";
      }
    }
  }

  // CPU recipes: prioritize host RAM; do not lead with GPU VRAM messaging.
  if (!estimate.usesGpu && systemRamGb != null) {
    const inferenceRamFit = compareVramFit(estimate.inferenceGb, systemRamGb);
    const peakRamFit = compareVramFit(estimate.peakRunGb, systemRamGb);
    if (inferenceRamFit === "insufficient") {
      fitHint = "Deployed model may exceed system RAM";
    } else if (peakRamFit === "insufficient") {
      fitHint = "Peak run may exceed system RAM";
    } else if (inferenceRamFit === "tight" || peakRamFit === "tight") {
      fitHint = "Tight on system RAM";
    }
  } else if (!estimate.usesGpu && availableGb != null && !fitHint) {
    // No system RAM reading: fall back to comparing the footprint against GPU VRAM.
    const inferenceFit = compareVramFit(estimate.inferenceGb, availableGb);
    if (inferenceFit === "insufficient") {
      fitHint = "Deployed model may exceed GPU VRAM";
    } else if (inferenceFit === "tight") {
      fitHint = "Tight on this GPU";
    }
  }

  // Use deployed (post-pass) size so quantized presets do not look like FP16 footprints.
  const summaryLine = `~${formatMemoryGb(estimate.inferenceGb)} ${beforeLabel} model · ~${formatMemoryGb(estimate.peakRunGb)} ${peakLabel} during run`;

  return {
    inferenceGb: estimate.inferenceGb,
    peakRunGb: estimate.peakRunGb,
    usesGpu: estimate.usesGpu,
    summaryLine,
    fitHint,
  };
}
