/**
 * Recipe dependency inference — determines which Python packages a recipe needs
 * based on pass types, model source, and GPU/execution provider.
 */
import type { IHVProvider } from "../../../types.ts";
import { recipeUsesMemoryOffload } from "../../../lib/memoryOffload.ts";
import { resolveCudaTag, RESOLVABLE_CUDA_TAGS } from "../../../lib/oliveGpuRuntime.ts";
import { tensorrtRtxInstallArgs, tensorrtRtxLabel } from "../../../lib/tensorrtRtxDeps.ts";
import { openvinoStackInstallArgs, openvinoStackLabel } from "../../../lib/openvinoDeps.ts";

/** Olive recipe shape (subset needed for inference). */
export interface OliveRecipe {
  passes?: Record<string, unknown>;
  input_model?: {
    type?: string;
    config?: Record<string, unknown>;
  };
  systems?: {
    local_system?: {
      config?: {
        accelerators?: Array<{ execution_providers?: string[] }>;
      };
      accelerators?: Array<{ execution_providers?: string[] }>;
    };
  };
  [key: string]: unknown;
}

export interface PkgDef {
  importName: string;
  installArgs: string[];
  label: string;
}

/** Derive the IHV execution provider from a recipe's accelerator config. */
export function getRecipeIhvProvider(recipe: OliveRecipe): IHVProvider {
  const system = recipe.systems?.local_system;
  const accelerators = system?.config?.accelerators ?? system?.accelerators;
  const ep = accelerators?.[0]?.execution_providers?.[0];
  if (typeof ep === "string" && ep.length > 0) {
    return ep as IHVProvider;
  }
  return "CUDAExecutionProvider";
}

/**
 * Inspect a recipe and return the list of Python packages that Olive
 * needs installed in the project venv to execute it.
 */
export function inferRequiredPackages(recipe: OliveRecipe, cudaTag: string): PkgDef[] {
  const pkgs: PkgDef[] = [];
  const passes = Object.values(recipe.passes ?? {}) as Array<Record<string, unknown>>;
  const passTypes = passes.map((p) => String(p?.type ?? ""));
  const isCpu = cudaTag === "cpu";
  const resolved = isCpu ? null : resolveCudaTag(cudaTag);
  if (!isCpu && !resolved) {
    throw new Error(
      `Unsupported CUDA tag "${cudaTag}". Supported: ${RESOLVABLE_CUDA_TAGS.join(", ")} (ORT 1.26 + CUDA 12 pins).`,
    );
  }
  const isGpu = resolved !== null;
  const inputType = String(recipe.input_model?.type ?? "");
  const inputConfig = (recipe.input_model?.config ?? {}) as Record<string, unknown>;

  // HuggingFace model source
  if (inputConfig.hf_config || inputType === "HfModel" || inputType.toLowerCase().includes("hf")) {
    pkgs.push({
      importName: "transformers",
      installArgs: ["transformers"],
      label: "transformers",
    });
    pkgs.push({
      importName: "accelerate",
      installArgs: ["accelerate"],
      label: "accelerate",
    });
  }

  if (recipeUsesMemoryOffload(recipe)) {
    pkgs.push({
      importName: "accelerate",
      installArgs: ["accelerate"],
      label: "accelerate",
    });
  }

  // PyTorch — CPU wheel or resolved CUDA wheel index
  pkgs.push(
    isGpu && resolved
      ? {
          importName: "torch",
          installArgs: ["torch", "--index-url", resolved.torchIndexUrl],
          label: `torch (${resolved.tag})`,
        }
      : {
          importName: "torch",
          installArgs: ["torch", "--index-url", "https://download.pytorch.org/whl/cpu"],
          label: "torch (CPU)",
        },
  );

  // ONNX Runtime — pin CUDA 12 build via resolveCudaTag
  if (passTypes.some((t) => t.includes("Onnx") || t.includes("ORT") || t.includes("Transformers"))) {
    pkgs.push(
      isGpu && resolved
        ? {
            importName: "onnxruntime",
            installArgs: resolved.ortInstallArgs,
            label: resolved.ortLabel,
          }
        : {
            importName: "onnxruntime",
            installArgs: ["onnxruntime"],
            label: "onnxruntime",
          },
    );
  }

  if (isGpu && resolved) {
    for (const pkg of resolved.runtimePackages) {
      pkgs.push(pkg);
    }
  }

  // OpenVINO runtime + Optimum-Intel bridge (single install action)
  if (passTypes.some((t) => t.includes("OpenVINO"))) {
    pkgs.push({
      importName: "openvino",
      installArgs: openvinoStackInstallArgs(),
      label: openvinoStackLabel(),
    });
  }

  // PEFT (LoRA / QLoRA)
  if (passTypes.some((t) => t === "LoRA" || t === "QLoRA")) {
    pkgs.push({ importName: "peft", installArgs: ["peft"], label: "peft" });
  }

  // AutoAWQ
  if (passTypes.some((t) => t.toLowerCase().includes("awq"))) {
    pkgs.push({ importName: "awq", installArgs: ["autoawq"], label: "autoawq" });
  }

  // TensorRT RTX (consumer GeForce)
  if (isGpu && getRecipeIhvProvider(recipe) === "NvTensorRTRTXExecutionProvider") {
    pkgs.push({
      importName: "tensorrt_rtx",
      installArgs: tensorrtRtxInstallArgs(),
      label: tensorrtRtxLabel(),
    });
  }

  // Classic TensorRT SDK — pin from CUDA tag resolution when EP requests it
  if (isGpu && resolved && getRecipeIhvProvider(recipe) === "TensorrtExecutionProvider") {
    pkgs.push({
      importName: "tensorrt",
      installArgs: resolved.tensorRtInstallArgs,
      label: resolved.tensorRtLabel,
    });
  }

  // Deduplicate by importName
  const seen = new Set<string>();
  return pkgs.filter((p) => (seen.has(p.importName) ? false : (seen.add(p.importName), true)));
}
