import { UIState, IHVProvider } from "@/types";
import { createInactivePasses, DEFAULT_PASSES } from "@/lib/defaultPasses";
import { memoryOffloadFromRecipe } from "@/lib/memoryOffload";

export const OLIVE_RECIPES_REPO = "microsoft/olive-recipes";
export const OLIVE_RECIPES_BRANCH = "main";

export interface RecipeCatalogItem {
  name: string;
  architecture: string;
  device: string;
  repoPath: string;
  description: string;
  /** How architecture/device tags were derived. Folder inference is approximate. */
  metadataSource?: "folder" | "recipe";
}

export interface ParsedGitHubTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export interface DeriveUiStateOptions {
  /** When true, pass toggles come only from the recipe (not merged with prior UI). */
  replacePasses?: boolean;
  basePasses?: UIState["passes"];
}

export function parseGitHubRecipeTarget(
  repoInput: string,
  branchInput: string,
  pathInput: string,
): ParsedGitHubTarget {
  const trimmed = repoInput.trim();

  if (trimmed.startsWith("https://github.com/") && trimmed.includes("/blob/")) {
    const withoutHost = trimmed.replace("https://github.com/", "");
    const [owner, repo, , branch, ...rest] = withoutHost.split("/");
    return {
      owner,
      repo,
      branch: branch || branchInput || "main",
      path: rest.join("/"),
    };
  }

  if (trimmed.startsWith("https://raw.githubusercontent.com/")) {
    const withoutHost = trimmed.replace("https://raw.githubusercontent.com/", "");
    const [owner, repo, branch, ...rest] = withoutHost.split("/");
    return {
      owner,
      repo,
      branch: branch || branchInput || "main",
      path: rest.join("/"),
    };
  }

  const cleanRepo = trimmed
    .replace(/^https:\/\/github.com\//, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");

  const path = pathInput.startsWith("/") ? pathInput.slice(1) : pathInput;
  const [owner, repo] = cleanRepo.split("/");

  if (!owner || !repo) {
    throw new Error("Repository must be in owner/repo or https://github.com/owner/repo format.");
  }

  return {
    owner,
    repo,
    branch: branchInput.trim() || "main",
    path,
  };
}

export function buildGitHubRawApiUrl(target: ParsedGitHubTarget): string {
  const params = new URLSearchParams({
    owner: target.owner,
    repo: target.repo,
    branch: target.branch,
    path: target.path,
  });
  return `/api/github/raw?${params.toString()}`;
}

export async function fetchGitHubRecipeJson(
  repoInput: string,
  branchInput: string,
  pathInput: string,
): Promise<{ json: unknown; target: ParsedGitHubTarget }> {
  const target = parseGitHubRecipeTarget(repoInput, branchInput, pathInput);
  if (!target.path.trim()) {
    throw new Error("Recipe path is required.");
  }

  const response = await fetch(buildGitHubRawApiUrl(target));
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: string }).error)
        : `GitHub sync failed (HTTP ${response.status}).`;
    throw new Error(message);
  }

  return { json: payload, target };
}

export async function fetchOliveRecipesCatalogItem(
  item: RecipeCatalogItem,
  repo = OLIVE_RECIPES_REPO,
  branch = OLIVE_RECIPES_BRANCH,
): Promise<unknown> {
  const { json } = await fetchGitHubRecipeJson(repo, branch, item.repoPath);
  return json;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapExecutionProviderFromRecipe(parsed: any): IHVProvider | undefined {
  const systems = parsed?.systems;
  if (systems && typeof systems === "object") {
    for (const system of Object.values(systems)) {
      const config = (system as { config?: { accelerators?: unknown[] }; accelerators?: unknown[] })?.config;
      const accelerators = config?.accelerators ?? (system as { accelerators?: unknown[] })?.accelerators;
      if (!Array.isArray(accelerators)) continue;
      for (const accelerator of accelerators) {
        const providers = (accelerator as { execution_providers?: unknown[] })?.execution_providers;
        if (!Array.isArray(providers) || providers.length === 0) continue;
        const token = String(providers[0]).toLowerCase();
        if (token.includes("cuda")) return "CUDAExecutionProvider";
        if (token.includes("nvtensorrtrtx") || token.includes("tensorrtrtx")) {
          return "NvTensorRTRTXExecutionProvider";
        }
        if (token.includes("tensorrt") || token.includes("trt")) return "TensorrtExecutionProvider";
        if (token.includes("directml") || token.includes("dml")) return "CPUExecutionProvider";
        if (token.includes("qnn")) return "QNNExecutionProvider";
        if (token.includes("openvino")) return "OpenVINOExecutionProvider";
        if (token.includes("rocm")) return "ROCMExecutionProvider";
      }
    }
  }
  return undefined;
}

/** Catalog device label from recipe JSON (more accurate than folder tags). */
export function getCatalogDeviceFromRecipe(parsed: unknown): string | undefined {
  const systems = (parsed as { systems?: Record<string, unknown> })?.systems;
  if (systems && typeof systems === "object") {
    for (const system of Object.values(systems)) {
      const config = (system as { config?: { accelerators?: unknown[] }; accelerators?: unknown[] })?.config;
      const accelerators = config?.accelerators ?? (system as { accelerators?: unknown[] })?.accelerators;
      if (!Array.isArray(accelerators)) continue;
      for (const accelerator of accelerators) {
        const providers = (accelerator as { execution_providers?: unknown[] })?.execution_providers;
        if (!Array.isArray(providers) || providers.length === 0) continue;
        const token = String(providers[0]).toLowerCase();
        if (token.includes("directml") || token.includes("dml")) return "DirectML";
        if (token.includes("nvtensorrtrtx") || token.includes("tensorrtrtx")) return "TensorRT RTX";
        if (token.includes("tensorrt") || token.includes("trt")) return "TensorRT";
        if (token.includes("cuda")) return "CUDA";
        if (token.includes("qnn")) return "QNN";
        if (token.includes("openvino")) return "OpenVINO";
        if (token.includes("rocm")) return "CUDA";
      }
    }
  }

  const provider = mapExecutionProviderFromRecipe(parsed);
  return provider ? mapProviderToCatalogDevice(provider) : undefined;
}

export function getExecutionProviderFromRecipe(parsed: unknown): IHVProvider | undefined {
  return mapExecutionProviderFromRecipe(parsed);
}

export function mapProviderToCatalogDevice(provider: IHVProvider): string {
  switch (provider) {
    case "CUDAExecutionProvider":
    case "ROCMExecutionProvider":
      return "CUDA";
    case "TensorrtExecutionProvider":
      return "TensorRT";
    case "NvTensorRTRTXExecutionProvider":
      return "TensorRT RTX";
    case "OpenVINOExecutionProvider":
      return "OpenVINO";
    case "QNNExecutionProvider":
      return "QNN";
    case "CPUExecutionProvider":
    default:
      return "CPU";
  }
}

export function compareCatalogMetadataToRecipe(
  item: RecipeCatalogItem,
  parsed: unknown,
): { catalogDevice: string; recipeDevice?: string; matches: boolean } {
  const provider = getExecutionProviderFromRecipe(parsed);
  const recipeDevice = provider ? mapProviderToCatalogDevice(provider) : undefined;
  return {
    catalogDevice: item.device,
    recipeDevice,
    matches: recipeDevice ? recipeDevice === item.device : true,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuantMethod(config: any, passType = ""): UIState["passes"]["quantMethod"] {
  const typeLower = passType.toLowerCase();
  if (typeLower.includes("autoawq")) {
    return "awq";
  }
  if (typeLower.includes("gptq")) return "gptq";
  if (typeLower.includes("spinquant")) return "spinquant";
  if (typeLower.includes("quarot")) return "quarot";
  if (typeLower.includes("hqq")) return "hqq";
  if (typeLower.includes("blockwisertn") || typeLower.includes("rtn")) return "rtn";

  const algorithm = String(config?.algorithm ?? "").toLowerCase();
  if (algorithm.includes("awq")) return "awq";
  if (algorithm.includes("gptq")) return "gptq";

  const mode = String(config?.quant_mode ?? config?.mode ?? "").toLowerCase();
  if (mode.includes("qat") || mode === "qlinearops") {
    return "qat";
  }
  return "ptq";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuantPrecision(config: any, passType = ""): UIState["passes"]["quantPrecision"] {
  const typeLower = passType.toLowerCase();
  if (typeLower.includes("weightcompression") || typeLower.includes("nvfp4")) {
    return "int4";
  }
  if (config?.bits != null) {
    return Number(config.bits) <= 4 ? "int4" : "int8";
  }
  if (config?.quant_level != null) {
    const ql = String(config.quant_level).toLowerCase();
    if (ql.includes("w4") || ql.includes("4")) return "int4";
    if (ql.includes("w8") || ql.includes("8")) return "int8";
  }
  const weight = String(config?.weight_type ?? config?.precision ?? "int8").toLowerCase();
  if (weight.includes("int4") || weight === "4") return "int4";
  if (weight.includes("fp16") || weight.includes("float16")) return "fp16";
  return "int8";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPruningCriteria(config: any): "l1_norm" | "l2_norm" | undefined {
  if (!config?.pruning_criteria) return undefined;
  return String(config.pruning_criteria).toLowerCase().includes("l2") ? "l2_norm" : "l1_norm";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPassesFromRecipe(recipePasses: Record<string, any>): UIState["passes"] {
  const next = createInactivePasses();

  for (const [key, pass] of Object.entries(recipePasses)) {
    if (!pass || typeof pass !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const type = String((pass as any).type ?? "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = (pass as any).config ?? {};
    const lowerType = type.toLowerCase();

    if (lowerType.includes("openvino") && lowerType.includes("conversion")) {
      next.conversion = true;
      next.conversionFormat = "openvino";
      continue;
    }

    if (lowerType.includes("onnx") && lowerType.includes("conversion")) {
      next.conversion = true;
      next.conversionFormat = "onnx";
      if (config.target_opset) next.conversionOpset = Number(config.target_opset);
      if (config.precision) next.conversionInputTargetTypes = String(config.precision);
      continue;
    }

    if (lowerType.includes("autoawq")) {
      next.quantization = true;
      next.quantMethod = "awq";
      next.quantPrecision = mapQuantPrecision(config, type);
      if (config.group_size != null) next.awqGroupSize = Number(config.group_size);
      if (config.damp_percent != null) next.awqDampPercent = Number(config.damp_percent);
      if (config.sym != null) next.awqSym = Boolean(config.sym);
      continue;
    }

    if (lowerType.includes("gptq")) {
      next.quantization = true;
      next.quantMethod = "gptq";
      next.quantPrecision = mapQuantPrecision(config, type);
      if (config.block_size != null) next.gptqBlockSize = Number(config.block_size);
      if (config.group_size != null) next.gptqGroupSize = Number(config.group_size);
      if (config.desc_act != null) next.gptqDescAct = Boolean(config.desc_act);
      continue;
    }

    if (lowerType.includes("spinquant")) {
      next.quantization = true;
      next.quantMethod = "spinquant";
      next.quantPrecision = mapQuantPrecision(config, type);
      continue;
    }

    if (lowerType.includes("quant")) {
      next.quantization = true;
      next.quantMethod = mapQuantMethod(config, type);
      next.quantPrecision = mapQuantPrecision(config, type);
      continue;
    }

    if (lowerType.includes("quarot")) {
      next.quantization = true;
      next.quantMethod = "quarot";
      next.quantPrecision = mapQuantPrecision(config, type);
      continue;
    }

    if (lowerType.includes("openvino") && lowerType.includes("weight")) {
      next.quantization = true;
      next.quantMethod = "ptq";
      next.quantPrecision = mapQuantPrecision(config, type);
      continue;
    }

    if (lowerType.includes("sparsegpt")) {
      next.pruning = true;
      next.pruningMethod = "sparsegpt";
      const sparsity = config.sparsity_ratio ?? config.target_sparsity ?? config.sparsity;
      if (sparsity != null) next.pruningSparsity = Number(sparsity);
      if (config.semi_sparse_acc) next.pruningType = "structured";
      const sparsegptCriteria = mapPruningCriteria(config);
      if (sparsegptCriteria) next.pruningCriteria = sparsegptCriteria;
      continue;
    }

    if (lowerType.includes("wanda")) {
      next.pruning = true;
      next.pruningMethod = "wanda";
      const sparsity = config.sparsity_ratio ?? config.target_sparsity ?? config.sparsity;
      if (sparsity != null) next.pruningSparsity = Number(sparsity);
      const wandaCriteria = mapPruningCriteria(config);
      if (wandaCriteria) next.pruningCriteria = wandaCriteria;
      continue;
    }

    if (lowerType.includes("prune")) {
      next.pruning = true;
      next.pruningMethod = "magnitude";
      const sparsity = config.sparsity_ratio ?? config.target_sparsity ?? config.sparsity;
      if (sparsity != null) next.pruningSparsity = Number(sparsity);
      if (config.semi_sparse_acc) next.pruningType = "structured";
      const pruneCriteria = mapPruningCriteria(config);
      if (pruneCriteria) next.pruningCriteria = pruneCriteria;
      continue;
    }

    if (lowerType.includes("qlora")) {
      next.peft = true;
      next.peftMethod = "qlora";
      continue;
    }

    if (lowerType.includes("lora") || key === "peft") {
      next.peft = true;
      next.peftMethod = "lora";
      continue;
    }

    if (lowerType.includes("split")) {
      next.splitting = true;
      continue;
    }

    if (lowerType.includes("transform") || key === "transformer_opt" || key === "transformers_optimization") {
      next.onnxTransforms = true;
      continue;
    }

    if (key === "builder") {
      next.conversion = true;
      next.conversionFormat = "onnx";
    }
  }

  return next;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deriveUiStateFromOliveRecipe(parsed: any, options?: DeriveUiStateOptions): Partial<UIState> {
  const incomingState: Partial<UIState> = {};
  const inputModel = parsed?.input_model;

  const hfConfig = inputModel?.config?.hf_config;
  const hfModelPath =
    typeof inputModel?.model_path === "string"
      ? inputModel.model_path
      : typeof inputModel?.config?.model_path === "string"
        ? inputModel.config.model_path
        : null;
  const hfName = hfConfig?.model_name || hfModelPath;

  if (hfName) {
    incomingState.modelSource = "huggingface";
    incomingState.hfModelId = hfName;
    if (hfConfig?.dataset) {
      incomingState.hfDataset = hfConfig.dataset;
    }
  }

  const localFiles = inputModel?.config?.local_files;
  if (Array.isArray(localFiles) && localFiles.length > 0) {
    incomingState.modelSource = "local";
    incomingState.localFiles = localFiles.map((name: string) => ({ name, size: 2_000_000_000 }));
  } else if (inputModel?.config?.model_path && !hfConfig && !hfModelPath?.includes("/")) {
    incomingState.modelSource = "local";
  }

  if (inputModel?.config?.model_path && incomingState.modelSource === "azure") {
    incomingState.azureModelPath = String(inputModel.config.model_path);
  } else if (inputModel?.config?.model_path && !hfConfig && hfModelPath?.includes("azure")) {
    incomingState.modelSource = "azure";
    incomingState.azureModelPath = hfModelPath;
  }

  const provider = mapExecutionProviderFromRecipe(parsed);
  if (provider) {
    incomingState.ihvProvider = provider;
  }

  const offloadMode = memoryOffloadFromRecipe(parsed);
  if (offloadMode) {
    incomingState.memoryOffload = offloadMode;
  }

  if (parsed?.passes && typeof parsed.passes === "object") {
    const mapped = mapPassesFromRecipe(parsed.passes);
    if (options?.replacePasses) {
      incomingState.passes = mapped;
    } else {
      const base = options?.basePasses ?? DEFAULT_PASSES;
      incomingState.passes = { ...base, ...mapped };
    }
  }

  return incomingState;
}
