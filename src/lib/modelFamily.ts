import { UIState } from "@/types";

export interface ModelFamilyTypeOption {
  value: string;
  label: string;
}

export interface ModelFamilyInfo {
  name: string;
  family: string;
  types: ModelFamilyTypeOption[];
  defaultType: string;
}

export function getSelectedModelInfo(state: UIState): ModelFamilyInfo {
  let identifier = "";
  if (state.modelSource === "huggingface") {
    identifier = state.hfModelId || "meta-llama/Llama-2-7b-hf";
  } else if (state.modelSource === "azure") {
    identifier = state.azureModelPath || "AzureML Asset Container";
  } else if (state.modelSource === "local") {
    if (state.localFiles && state.localFiles.length > 0) {
      identifier = state.localFiles[0].name;
    } else {
      identifier = "";
    }
  }

  const idLower = identifier.toLowerCase();

  if (
    idLower.includes("llama") ||
    idLower.includes("mistral") ||
    idLower.includes("phi") ||
    idLower.includes("gemma") ||
    idLower.includes("qwen") ||
    idLower.includes("instruct") ||
    idLower.includes("minicpm")
  ) {
    return {
      name: identifier,
      family: "LLM (Generative Text)",
      types: [
        { value: "float16", label: "float16 (Optimized for standard GPU)" },
        { value: "bfloat16", label: "bfloat16 (Optimized for Ampere+ GPUs/TPUs)" },
        { value: "float32", label: "float32 (Full precision, CPU standard)" },
      ],
      defaultType: "float16",
    };
  }

  if (idLower.includes("whisper")) {
    return {
      name: identifier,
      family: "Speech-to-Text Transformer",
      types: [
        { value: "float16", label: "float16 (Fast GPU Audio pipeline)" },
        { value: "float32", label: "float32 (Standard full precision)" },
        { value: "int8", label: "int8 (Highly-compressed quantization target)" },
      ],
      defaultType: "float16",
    };
  }

  if (
    idLower.includes("diffusion") ||
    idLower.includes("sd15") ||
    idLower.includes("unet") ||
    idLower.includes("sdxl") ||
    idLower.includes("flux")
  ) {
    return {
      name: identifier,
      family: "Latent Diffusion Model",
      types: [
        { value: "float16", label: "float16 (Low VRAM - Recommended for SD/Flux)" },
        { value: "float32", label: "float32 (High Fidelity Full Precision)" },
      ],
      defaultType: "float16",
    };
  }

  if (idLower.includes("bert") || idLower.includes("roberta") || idLower.includes("t5")) {
    return {
      name: identifier,
      family: "Transformer Encoder (NLP)",
      types: [
        { value: "float32", label: "float32 (Highly stable standard)" },
        { value: "float16", label: "float16 (Optimized for fast GPU execution)" },
        { value: "int32", label: "int32 (For token ID inputs)" },
        { value: "int64", label: "int64 (High-precision token IDs)" },
      ],
      defaultType: "float32",
    };
  }

  return {
    name: identifier || "Generic Model Workspace",
    family: "Generic Neural Network",
    types: [
      { value: "float32", label: "float32 (Standard multi-purpose format)" },
      { value: "float16", label: "float16 (Half precision target)" },
      { value: "int8", label: "int8 (Quantized deployment format)" },
      { value: "int32", label: "int32 (Integer input labels)" },
    ],
    defaultType: "float32",
  };
}

export function getDefaultConversionInputType(state: UIState): string {
  return getSelectedModelInfo(state).defaultType;
}

export function isDiffusionModel(state: UIState): boolean {
  const info = getSelectedModelInfo(state);
  const idLower = info.name.toLowerCase();
  return (
    idLower.includes("diffusion") ||
    idLower.includes("sd15") ||
    idLower.includes("unet") ||
    idLower.includes("sdxl") ||
    idLower.includes("flux")
  );
}

export function getPeftBlockReason(provider: UIState["ihvProvider"]): string {
  if (provider === "QNNExecutionProvider") {
    return "Incompatible with Snapdragon NPU";
  }
  if (provider === "OpenVINOExecutionProvider") {
    return "Incompatible with OpenVINO";
  }
  return "Incompatible with selected execution provider";
}
