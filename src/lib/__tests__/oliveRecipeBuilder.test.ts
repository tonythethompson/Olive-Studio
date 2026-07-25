import { describe, it, expect } from "vitest";
import {
  inferHfTask,
  inferModelType,
  providerToAccelerator,
  buildOliveRecipe,
} from "@/lib/oliveRecipeBuilder";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState, IHVProvider } from "@/types";

// ─── Test helpers ──────────────────────────────────────────────

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider" as IHVProvider,
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: {
      ...DEFAULT_PASSES,
      ...overrides?.passes,
    },
  };
}

// ─── inferHfTask ───────────────────────────────────────────────

describe("inferHfTask", () => {
  it("returns 'speech-recognition' for whisper models", () => {
    expect(inferHfTask("openai/whisper-large-v3")).toBe("speech-recognition");
    expect(inferHfTask("openai/whisper-tiny.en")).toBe("speech-recognition");
  });

  it("returns 'fill-mask' for BERT-family models", () => {
    expect(inferHfTask("bert-base-uncased")).toBe("fill-mask");
    expect(inferHfTask("roberta-large")).toBe("fill-mask");
    expect(inferHfTask("microsoft/deberta-v3-base")).toBe("fill-mask");
  });

  it("returns 'text2text-generation' for T5 and BART models", () => {
    expect(inferHfTask("t5-small")).toBe("text2text-generation");
    expect(inferHfTask("facebook/bart-large")).toBe("text2text-generation");
  });

  it("returns 'image-classification' for vision models", () => {
    expect(inferHfTask("google/vit-base-patch16-224")).toBe("image-classification");
    expect(inferHfTask("openai/clip-vit-base-patch32")).toBe("image-classification");
    expect(inferHfTask("microsoft/resnet-50")).toBe("image-classification");
    expect(inferHfTask("google/mobilenet_v2")).toBe("image-classification");
  });

  it("returns 'text-generation' for LLMs and unknown models", () => {
    expect(inferHfTask("meta-llama/Meta-Llama-3-8B")).toBe("text-generation");
    expect(inferHfTask("microsoft/Phi-3-mini-4k-instruct")).toBe("text-generation");
    expect(inferHfTask("Qwen/Qwen2.5-1.5B-Instruct")).toBe("text-generation");
    expect(inferHfTask("mistralai/Mistral-7B-v0.1")).toBe("text-generation");
    expect(inferHfTask("unknown-model-name")).toBe("text-generation");
    expect(inferHfTask("")).toBe("text-generation");
  });
});

// ─── inferModelType ────────────────────────────────────────────

describe("inferModelType", () => {
  it("returns 'llama' for Llama models", () => {
    expect(inferModelType("meta-llama/Meta-Llama-3-8B")).toBe("llama");
    expect(inferModelType("codellama/CodeLlama-7b-hf")).toBe("llama");
  });

  it("returns 'phi' for Phi models", () => {
    expect(inferModelType("microsoft/Phi-3-mini-4k-instruct")).toBe("phi");
    expect(inferModelType("microsoft/phi-2")).toBe("phi");
  });

  it("returns 'whisper' for Whisper models", () => {
    expect(inferModelType("openai/whisper-large-v3")).toBe("whisper");
  });

  it("returns 'bert' for BERT-family models", () => {
    expect(inferModelType("bert-base-uncased")).toBe("bert");
    expect(inferModelType("roberta-large")).toBe("bert");
  });

  it("returns 'qwen' for Qwen models", () => {
    expect(inferModelType("Qwen/Qwen2.5-1.5B-Instruct")).toBe("qwen");
    expect(inferModelType("Qwen/Qwen2-7B")).toBe("qwen");
  });

  it("returns 'mistral' for Mistral/Mixtral models", () => {
    expect(inferModelType("mistralai/Mistral-7B-v0.1")).toBe("mistral");
    expect(inferModelType("mistralai/Mixtral-8x7B-v1")).toBe("mistral");
  });

  it("returns 'falcon' for Falcon models", () => {
    expect(inferModelType("tiiuae/falcon-7b")).toBe("falcon");
  });

  it("returns 't5' for T5 models", () => {
    expect(inferModelType("t5-small")).toBe("t5");
  });

  it("returns 'gpt2' as default fallback for GPT-2 and unknown models", () => {
    expect(inferModelType("gpt2")).toBe("gpt2");
    expect(inferModelType("gpt-2-medium")).toBe("gpt2");
    expect(inferModelType("unknown-model")).toBe("gpt2");
    expect(inferModelType("")).toBe("gpt2");
  });
});

// ─── providerToAccelerator ─────────────────────────────────────

describe("providerToAccelerator", () => {
  it("maps CUDA to gpu device", () => {
    const result = providerToAccelerator("CUDAExecutionProvider");
    expect(result.device).toBe("gpu");
    expect(result.execution_providers).toEqual(["CUDAExecutionProvider"]);
  });

  it("maps TensorRT providers to gpu device", () => {
    expect(providerToAccelerator("TensorrtExecutionProvider").device).toBe("gpu");
    expect(providerToAccelerator("NvTensorRTRTXExecutionProvider").device).toBe("gpu");
  });

  it("maps ROCm to gpu device", () => {
    expect(providerToAccelerator("ROCMExecutionProvider").device).toBe("gpu");
  });

  it("maps QNN to npu device", () => {
    const result = providerToAccelerator("QNNExecutionProvider");
    expect(result.device).toBe("npu");
    expect(result.execution_providers).toEqual(["QNNExecutionProvider"]);
  });

  it("maps CPU and OpenVINO to cpu device", () => {
    expect(providerToAccelerator("CPUExecutionProvider").device).toBe("cpu");
    expect(providerToAccelerator("OpenVINOExecutionProvider").device).toBe("cpu");
  });

  it("returns execution_providers array containing the provider string", () => {
    const providers: IHVProvider[] = [
      "CPUExecutionProvider",
      "CUDAExecutionProvider",
      "TensorrtExecutionProvider",
      "NvTensorRTRTXExecutionProvider",
      "OpenVINOExecutionProvider",
      "QNNExecutionProvider",
      "ROCMExecutionProvider",
    ];
    for (const p of providers) {
      expect(providerToAccelerator(p).execution_providers).toEqual([p]);
    }
  });
});

// ─── buildOliveRecipe ──────────────────────────────────────────

describe("buildOliveRecipe", () => {
  it("produces a valid recipe with required top-level keys", () => {
    const state = baseState();
    const recipe = buildOliveRecipe(state);
    expect(recipe).toHaveProperty("input_model");
    expect(recipe).toHaveProperty("systems");
    expect(recipe).toHaveProperty("passes");
    expect(recipe).toHaveProperty("engine");
  });

  it("creates a PyTorchModel input_model by default", () => {
    const state = baseState({ modelSource: "huggingface" });
    const recipe = buildOliveRecipe(state);
    const inputModel = recipe.input_model as Record<string, unknown>;
    expect(inputModel.type).toBe("PyTorchModel");
  });

  it("creates HfModel type when memory offload is active", () => {
    const state = baseState({
      memoryOffload: "auto",
      ihvProvider: "CUDAExecutionProvider",
      modelSource: "huggingface",
      hfModelId: "meta-llama/Meta-Llama-3-8B",
    });
    const recipe = buildOliveRecipe(state);
    const inputModel = recipe.input_model as Record<string, unknown>;
    expect(inputModel.type).toBe("HfModel");
  });

  it("includes dataset in HfModel input config when memory offload and hfDataset are set", () => {
    const state = baseState({
      memoryOffload: "auto",
      ihvProvider: "CUDAExecutionProvider",
      modelSource: "huggingface",
      hfModelId: "meta-llama/Meta-Llama-3-8B",
      hfDataset: "wikitext",
    });
    const recipe = buildOliveRecipe(state);
    const inputConfig = (recipe.input_model as Record<string, unknown>).config as Record<string, unknown>;
    expect(inputConfig.dataset).toBe("wikitext");
  });

  it("includes hf_config for Hugging Face models without offload", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "bert-base-uncased",
      hfDataset: "wikitext",
    });
    const recipe = buildOliveRecipe(state);
    const config = (recipe.input_model as Record<string, unknown>).config as Record<string, unknown>;
    expect(config.hf_config).toBeDefined();
    const hf = config.hf_config as Record<string, unknown>;
    expect(hf.model_name).toBe("bert-base-uncased");
    expect(hf.task).toBe("fill-mask");
    expect(hf.dataset).toBe("wikitext");
  });

  it("sets local model config for local model source", () => {
    const state = baseState({
      modelSource: "local",
      localFiles: [{ name: "model.bin", size: 1000 }],
    });
    const recipe = buildOliveRecipe(state);
    const config = (recipe.input_model as Record<string, unknown>).config as Record<string, unknown>;
    expect(config.model_path).toBe("./local_models");
    expect(config.local_files).toEqual(["model.bin"]);
  });

  it("sets Azure model path for azure source", () => {
    const state = baseState({
      modelSource: "azure",
      azureModelPath: "azureml://model/123",
    });
    const recipe = buildOliveRecipe(state);
    const config = (recipe.input_model as Record<string, unknown>).config as Record<string, unknown>;
    expect(config.model_path).toBe("azureml://model/123");
  });

  it("configures engine with fixed pipeline defaults", () => {
    const state = baseState();
    const recipe = buildOliveRecipe(state);
    const engine = recipe.engine as Record<string, unknown>;
    expect(engine.search_strategy).toBe(false);
    expect(engine.host).toBe("local_system");
    expect(engine.target).toBe("local_system");
    expect(engine.output_dir).toBe("./models/optimized");
  });

  it("uses cache_dir from state when set", () => {
    const state = baseState({ cacheDir: "/custom/cache" });
    const recipe = buildOliveRecipe(state);
    expect((recipe.engine as Record<string, unknown>).cache_dir).toBe("/custom/cache");
  });

  it("uses azureStr for cache when distributed caching is enabled", () => {
    const state = baseState({
      distributedCaching: true,
      azureStr: "azure://cache/container",
      cacheDir: "/local/cache",
    });
    const recipe = buildOliveRecipe(state);
    expect((recipe.engine as Record<string, unknown>).cache_dir).toBe("azure://cache/container");
  });

  it("creates OnnxConversion pass with correct config", () => {
    const state = baseState({
      ihvProvider: "CUDAExecutionProvider",
      passes: {
        ...DEFAULT_PASSES,
        conversion: true,
        conversionFormat: "onnx",
        conversionOpset: 20,
        conversionInputTargetTypes: "float32",
        conversionSourceFormat: "pytorch",
      },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    expect(passes.conversion).toBeDefined();
    const conv = passes.conversion as Record<string, unknown>;
    expect(conv.type).toBe("OnnxConversion");
    const cfg = conv.config as Record<string, unknown>;
    expect(cfg.target_opset).toBe(20);
    expect(cfg.input_model_dtype).toBe("float32");
    expect(cfg.source_format).toBe("pytorch");
  });

  it("creates OpenVINOConversion pass when format is openvino", () => {
    const state = baseState({
      ihvProvider: "OpenVINOExecutionProvider",
      passes: { ...DEFAULT_PASSES, conversion: true, conversionFormat: "openvino" },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    expect(passes.conversion).toBeDefined();
    expect((passes.conversion as Record<string, unknown>).type).toBe("OpenVINOConversion");
  });

  it("creates AutoAWQQuantizer for AWQ method", () => {
    const state = baseState({
      ihvProvider: "CUDAExecutionProvider",
      passes: { ...DEFAULT_PASSES, quantization: true, quantMethod: "awq", quantPrecision: "int4" },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    const q = passes.quantization as Record<string, unknown>;
    expect(q.type).toBe("AutoAWQQuantizer");
    expect((q.config as Record<string, unknown>).bits).toBe(4);
  });

  it("includes data_config and user_script in AWQ config when dataset and userScript are set", () => {
    const state = baseState({
      userScript: "/awq/custom.py",
      hfDataset: "wikitext",
      ihvProvider: "CUDAExecutionProvider",
      passes: { ...DEFAULT_PASSES, quantization: true, quantMethod: "awq", quantPrecision: "int8" },
    });
    const recipe = buildOliveRecipe(state);
    const q = (recipe.passes as Record<string, unknown>).quantization as Record<string, unknown>;
    expect(q.type).toBe("AutoAWQQuantizer");
    const cfg = q.config as Record<string, unknown>;
    expect(cfg.data_config).toEqual({ data_dir: "wikitext", batch_size: 1 });
    expect(cfg.user_script).toBe("/awq/custom.py");
  });

  it("creates GPTQQuantizer with advanced config for GPTQ method", () => {
    const state = baseState({
      ihvProvider: "CUDAExecutionProvider",
      passes: {
        ...DEFAULT_PASSES,
        quantization: true,
        quantMethod: "gptq",
        quantPrecision: "int4",
        gptqBlockSize: 64,
        gptqDescAct: true,
        gptqGroupSize: 128,
      },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    const q = passes.quantization as Record<string, unknown>;
    expect(q.type).toBe("GptqQuantizer");
    const cfg = q.config as Record<string, unknown>;
    expect(cfg.bits).toBe(4);
    expect(cfg.block_size).toBe(64);
    expect(cfg.desc_act).toBe(true);
    expect(cfg.group_size).toBe(128);
  });

  it("includes data_config in GPTQ when hfDataset is provided", () => {
    const state = baseState({
      ihvProvider: "CUDAExecutionProvider",
      hfDataset: "wikitext",
      passes: {
        ...DEFAULT_PASSES,
        quantization: true,
        quantMethod: "gptq",
        quantPrecision: "int4",
      },
    });
    const recipe = buildOliveRecipe(state);
    const q = (recipe.passes as Record<string, unknown>).quantization as Record<string, unknown>;
    const cfg = q.config as Record<string, unknown>;
    expect(cfg.data_config).toEqual({ data_dir: "wikitext", batch_size: 1 });
  });

  it("includes user_script in GPTQ config when provided", () => {
    const state = baseState({
      userScript: "/gptq/custom.py",
      hfDataset: "wikitext",
      ihvProvider: "CUDAExecutionProvider",
      passes: {
        ...DEFAULT_PASSES,
        quantization: true,
        quantMethod: "gptq",
        quantPrecision: "int4",
      },
    });
    const recipe = buildOliveRecipe(state);
    const q = (recipe.passes as Record<string, unknown>).quantization as Record<string, unknown>;
    const cfg = q.config as Record<string, unknown>;
    expect(cfg.user_script).toBe("/gptq/custom.py");
    expect(cfg.data_config).toEqual({ data_dir: "wikitext", batch_size: 1 });
  });

  it("creates OnnxQuantization for PTQ method", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, quantization: true, quantMethod: "ptq", quantPrecision: "int8" },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    const q = passes.quantization as Record<string, unknown>;
    expect(q.type).toBe("OnnxQuantization");
    expect((q.config as Record<string, unknown>).precision).toBe("int8");
    expect((q.config as Record<string, unknown>).quant_mode).toBe("static");
  });

  it("adds user_script to quantization config when provided", () => {
    const state = baseState({
      userScript: "/path/to/script.py",
      hfDataset: "wikitext",
      passes: { ...DEFAULT_PASSES, quantization: true, quantMethod: "ptq" },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    const q = passes.quantization as Record<string, unknown>;
    const cfg = q.config as Record<string, unknown>;
    expect(cfg.user_script).toBe("/path/to/script.py");
    expect(cfg.data_config).toEqual({ data_dir: "wikitext", batch_size: 1 });
  });

  it("creates OrtTransformersOptimization with correct model_type and use_gpu", () => {
    const state = baseState({
      ihvProvider: "CUDAExecutionProvider",
      hfModelId: "meta-llama/Meta-Llama-3-8B",
      passes: { ...DEFAULT_PASSES, onnxTransforms: true },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    const t = passes.transformer_opt as Record<string, unknown>;
    expect(t.type).toBe("OrtTransformersOptimization");
    expect((t.config as Record<string, unknown>).model_type).toBe("llama");
    expect((t.config as Record<string, unknown>).use_gpu).toBe(true);
  });

  it("includes user_script in ORT transforms config when provided", () => {
    const state = baseState({
      userScript: "/ort/custom.py",
      ihvProvider: "CUDAExecutionProvider",
      passes: { ...DEFAULT_PASSES, onnxTransforms: true },
    });
    const recipe = buildOliveRecipe(state);
    const t = (recipe.passes as Record<string, unknown>).transformer_opt as Record<string, unknown>;
    expect((t.config as Record<string, unknown>).user_script).toBe("/ort/custom.py");
  });

  it("sets use_gpu to false for CPU providers", () => {
    const state = baseState({
      ihvProvider: "CPUExecutionProvider",
      passes: { ...DEFAULT_PASSES, onnxTransforms: true },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    expect((passes.transformer_opt as Record<string, unknown>).config).toHaveProperty("use_gpu", false);
  });

  it("creates ModelSplitting pass when enabled", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, splitting: true },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    expect((passes.splitting as Record<string, unknown>).type).toBe("SplitModel");
  });

  it("creates LoRA pass with correct config", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, peft: true, peftMethod: "lora" },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    const p = passes.peft as Record<string, unknown>;
    expect(p.type).toBe("LoRA");
    expect((p.config as Record<string, unknown>).r).toBe(8);
    expect((p.config as Record<string, unknown>).alpha).toBe(16);
  });

  it("creates QLoRA pass for qlora method", () => {
    const state = baseState({
      ihvProvider: "CUDAExecutionProvider",
      passes: { ...DEFAULT_PASSES, peft: true, peftMethod: "qlora" },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    expect((passes.peft as Record<string, unknown>).type).toBe("QLoRA");
  });

  it("applies memory offload config to PEFT when active", () => {
    const state = baseState({
      memoryOffload: "auto",
      modelSource: "huggingface",
      hfModelId: "meta-llama/Meta-Llama-3-8B",
      ihvProvider: "CUDAExecutionProvider",
      passes: { ...DEFAULT_PASSES, peft: true, peftMethod: "lora" },
    });
    const recipe = buildOliveRecipe(state);
    const p = (recipe.passes as Record<string, unknown>).peft as Record<string, unknown>;
    const cfg = p.config as Record<string, unknown>;
    // When memory offload is active, HfModel type is used and PEFT config gets offload fields
    expect((recipe.input_model as Record<string, unknown>).type).toBe("HfModel");
    expect(cfg.r).toBe(8);
    expect(cfg.alpha).toBe(16);
  });

  it("sets diffusion_lora when enabled", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, peft: true, peftMethod: "lora", diffusionLora: true },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    expect((passes.peft as Record<string, unknown>).config).toHaveProperty("diffusion_lora", true);
  });

  it("creates SparseGPT pruning pass", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "sparsegpt", pruningSparsity: 0.5 },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    const p = passes.pruning as Record<string, unknown>;
    expect(p.type).toBe("SparseGPT");
    expect((p.config as Record<string, unknown>).sparsity).toBe(0.5);
  });

  it("creates Wanda pruning pass", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "wanda", pruningSparsity: 0.3 },
    });
    const recipe = buildOliveRecipe(state);
    expect((recipe.passes as Record<string, unknown>).pruning).toHaveProperty("type", "Wanda");
  });

  it("creates magnitude-based Prune pass for magnitude method", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "magnitude", pruningSparsity: 0.4 },
    });
    const recipe = buildOliveRecipe(state);
    const passes = recipe.passes as Record<string, unknown>;
    expect((passes.pruning as Record<string, unknown>).type).toBe("Prune");
  });

  it("includes user_script in pruning config when provided", () => {
    const state = baseState({
      userScript: "/prune/custom.py",
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "magnitude", pruningSparsity: 0.5 },
    });
    const recipe = buildOliveRecipe(state);
    const p = (recipe.passes as Record<string, unknown>).pruning as Record<string, unknown>;
    expect(p.type).toBe("Prune");
    expect((p.config as Record<string, unknown>).user_script).toBe("/prune/custom.py");
    expect((p.config as Record<string, unknown>).sparsity).toBe(0.5);
  });

  it("defaults pruning_criteria to l1_norm when not explicitly set", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "magnitude" },
    });
    const recipe = buildOliveRecipe(state);
    const cfg = ((recipe.passes as Record<string, unknown>).pruning as Record<string, unknown>)
      .config as Record<string, unknown>;
    expect(cfg.pruning_criteria).toBe("l1_norm");
  });

  it("maps pruning_criteria to l2_norm for magnitude method", () => {
    const state = baseState({
      passes: {
        ...DEFAULT_PASSES,
        pruning: true,
        pruningMethod: "magnitude",
        pruningSparsity: 0.4,
        pruningCriteria: "l2_norm",
      },
    });
    const recipe = buildOliveRecipe(state);
    const cfg = ((recipe.passes as Record<string, unknown>).pruning as Record<string, unknown>)
      .config as Record<string, unknown>;
    expect(cfg.pruning_criteria).toBe("l2_norm");
  });

  it("maps pruning_criteria to l1_norm for magnitude method", () => {
    const state = baseState({
      passes: {
        ...DEFAULT_PASSES,
        pruning: true,
        pruningMethod: "magnitude",
        pruningSparsity: 0.4,
        pruningCriteria: "l1_norm",
      },
    });
    const recipe = buildOliveRecipe(state);
    const cfg = ((recipe.passes as Record<string, unknown>).pruning as Record<string, unknown>)
      .config as Record<string, unknown>;
    expect(cfg.pruning_criteria).toBe("l1_norm");
  });

  // Olive SparseGPT / Wanda passes do not consume pruning_criteria at runtime,
  // but the builder includes it for recipe round-trip fidelity.
  it("includes pruning_criteria in SparseGPT config for round-trip fidelity", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "sparsegpt", pruningCriteria: "l2_norm" },
    });
    const cfg = (
      (buildOliveRecipe(state).passes as Record<string, unknown>).pruning as Record<string, unknown>
    ).config as Record<string, unknown>;
    expect(cfg.pruning_criteria).toBe("l2_norm");
  });

  it("includes pruning_criteria in Wanda config for round-trip fidelity", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "wanda", pruningCriteria: "l1_norm" },
    });
    const cfg = (
      (buildOliveRecipe(state).passes as Record<string, unknown>).pruning as Record<string, unknown>
    ).config as Record<string, unknown>;
    expect(cfg.pruning_criteria).toBe("l1_norm");
  });

  it("preserves pruning_criteria through recipe import round-trip (l2_norm)", () => {
    const state = baseState({
      passes: {
        ...DEFAULT_PASSES,
        pruning: true,
        pruningMethod: "magnitude",
        pruningSparsity: 0.4,
        pruningCriteria: "l2_norm",
      },
    });
    const recipe = buildOliveRecipe(state);
    const imported = deriveUiStateFromOliveRecipe(recipe, { replacePasses: true });
    expect(imported.passes?.pruning).toBe(true);
    expect(imported.passes?.pruningMethod).toBe("magnitude");
    expect(imported.passes?.pruningCriteria).toBe("l2_norm");
  });

  it("preserves pruning_criteria through recipe import round-trip (l1_norm)", () => {
    const state = baseState({
      passes: {
        ...DEFAULT_PASSES,
        pruning: true,
        pruningMethod: "magnitude",
        pruningSparsity: 0.4,
        pruningCriteria: "l1_norm",
      },
    });
    const recipe = buildOliveRecipe(state);
    const imported = deriveUiStateFromOliveRecipe(recipe, { replacePasses: true });
    expect(imported.passes?.pruning).toBe(true);
    expect(imported.passes?.pruningMethod).toBe("magnitude");
    expect(imported.passes?.pruningCriteria).toBe("l1_norm");
  });

  it("preserves pruning_criteria through recipe import round-trip (sparsegpt)", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "sparsegpt", pruningCriteria: "l2_norm" },
    });
    const recipe = buildOliveRecipe(state);
    const imported = deriveUiStateFromOliveRecipe(recipe, { replacePasses: true });
    expect(imported.passes?.pruning).toBe(true);
    expect(imported.passes?.pruningMethod).toBe("sparsegpt");
    // SparseGPT doesn't consume pruning_criteria at runtime, but the builder
    // includes it in the config for round-trip fidelity.
    expect(imported.passes?.pruningCriteria).toBe("l2_norm");
  });

  it("preserves pruning_criteria through recipe import round-trip (wanda)", () => {
    const state = baseState({
      passes: { ...DEFAULT_PASSES, pruning: true, pruningMethod: "wanda", pruningCriteria: "l1_norm" },
    });
    const recipe = buildOliveRecipe(state);
    const imported = deriveUiStateFromOliveRecipe(recipe, { replacePasses: true });
    expect(imported.passes?.pruning).toBe(true);
    expect(imported.passes?.pruningMethod).toBe("wanda");
    expect(imported.passes?.pruningCriteria).toBe("l1_norm");
  });

  it("includes evaluators block when userScript and hfDataset are both set", () => {
    const state = baseState({
      userScript: "/path/to/eval.py",
      hfDataset: "wikitext",
    });
    const recipe = buildOliveRecipe(state);
    expect(recipe.evaluators).toBeDefined();
    const evals = recipe.evaluators as Record<string, unknown>;
    expect(evals.common_evaluator).toBeDefined();
  });

  it("omits evaluators block when userScript or hfDataset is missing", () => {
    const withoutScript = baseState({ hfDataset: "wikitext", userScript: undefined });
    expect(buildOliveRecipe(withoutScript).evaluators).toBeUndefined();

    const withoutData = baseState({ userScript: "/path.py", hfDataset: "" });
    expect(buildOliveRecipe(withoutData).evaluators).toBeUndefined();
  });

  it("generates the same structure for all providers", () => {
    const providers: IHVProvider[] = [
      "CPUExecutionProvider",
      "CUDAExecutionProvider",
      "TensorrtExecutionProvider",
      "NvTensorRTRTXExecutionProvider",
      "OpenVINOExecutionProvider",
      "QNNExecutionProvider",
      "ROCMExecutionProvider",
    ];
    for (const provider of providers) {
      const state = baseState({ ihvProvider: provider });
      const recipe = buildOliveRecipe(state);
      expect(recipe.systems).toBeDefined();
      const systemConfig = (
        (recipe.systems as Record<string, unknown>).local_system as Record<string, unknown>
      ).config as Record<string, unknown>;
      const accelerators = systemConfig.accelerators as { device: string; execution_providers?: string[] }[];
      expect(accelerators.length).toBe(1);
      expect(accelerators[0].execution_providers).toEqual([provider]);
    }
  });
});
