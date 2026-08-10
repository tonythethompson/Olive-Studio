import { UIState, IHVProvider, OpenVinoTargetDevice } from "@/types";
import { createInactivePasses, DEFAULT_PASSES } from "@/lib/defaultPasses";
import { memoryOffloadFromRecipe } from "@/lib/memoryOffload";
import { normalizeOpenVinoTargetDevice } from "@/lib/openvinoDeps";

export const OLIVE_RECIPES_REPO = "microsoft/olive-recipes";
export const OLIVE_RECIPES_BRANCH_DEFAULT = "main";

/**
 * Returns the active recipes branch/ref.
 * Reads from localStorage pin first, then falls back to default.
 * Allows users to pin a specific tag/branch for reproducible recipe imports.
 */
export function getRecipesBranch(): string {
  try {
    const pinned = localStorage.getItem("olive:recipes-branch");
    if (pinned && /^[A-Za-z0-9_./-]+$/.test(pinned)) return pinned;
  } catch {
    // localStorage unavailable (SSR / Tauri edge case)
  }
  return OLIVE_RECIPES_BRANCH_DEFAULT;
}

/** Pin the recipes branch/ref for subsequent fetches. Pass null to reset. */
export function setRecipesBranch(ref: string | null): void {
  try {
    if (ref) {
      localStorage.setItem("olive:recipes-branch", ref);
    } else {
      localStorage.removeItem("olive:recipes-branch");
    }
  } catch {
    // noop
  }
}

/** @deprecated Use getRecipesBranch() for dynamic resolution. */
export const OLIVE_RECIPES_BRANCH = OLIVE_RECIPES_BRANCH_DEFAULT;

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

/**
 * Determines whether a value is a non-null object with string keys.
 *
 * @returns `true` if the value is a record, `false` otherwise.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Determines whether a value is an array containing only strings.
 *
 * @param value - The value to check
 * @returns `true` if the value is an array of strings, `false` otherwise.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Parses a GitHub repository or file URL into its repository, branch, and file path components.
 *
 * @param repoInput - A GitHub repository URL, raw file URL, or `owner/repo` value
 * @param branchInput - The branch to use when it is not specified in `repoInput`
 * @param pathInput - The file path to use when it is not specified in `repoInput`
 * @returns The parsed repository owner, repository name, branch, and file path
 */
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

/**
 * Fetches a recipe catalog item from the configured Olive recipes repository.
 *
 * @param item - The catalog item whose repository path identifies the recipe
 * @param repo - The GitHub repository containing the recipe
 * @param branch - The repository branch containing the recipe
 * @returns The parsed recipe catalog item payload
 */
export async function fetchOliveRecipesCatalogItem(
  item: RecipeCatalogItem,
  repo = OLIVE_RECIPES_REPO,
  branch = getRecipesBranch(),
): Promise<unknown> {
  const { json } = await fetchGitHubRecipeJson(repo, branch, item.repoPath);
  return json;
}

/**
 * Determines the execution provider declared by a recipe's accelerator configuration.
 *
 * @returns The first recognized execution provider, or `undefined` when the recipe has no recognized provider.
 */
function mapExecutionProviderFromRecipe(parsed: unknown): IHVProvider | undefined {
  const recipe = parsed as Record<string, unknown> | undefined;
  const systems = recipe?.systems as Record<string, unknown> | undefined;
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
        if (token.includes("directml") || token.includes("dml")) return "DmlExecutionProvider";
        if (token.includes("qnn")) return "QNNExecutionProvider";
        if (token.includes("openvino")) return "OpenVINOExecutionProvider";
        if (token.includes("webgpu")) return "WebGpuExecutionProvider";
        if (token.includes("rocm")) return "ROCMExecutionProvider";
        if (token.includes("coreml")) return "CoreMLExecutionProvider";
        if (token.includes("nnapi")) return "NNAPIExecutionProvider";
        if (token.includes("vitisai") || token.includes("vitis-ai") || token.includes("vitis_ai")) {
          return "VitisAIExecutionProvider";
        }
        if (token.includes("snpe")) return "SNPEExecutionProvider";
        if (token.includes("tflite") || token.includes("tensorflowlite")) {
          return "TensorflowLiteExecutionProvider";
        }
        if (token.includes("xnnpack")) return "XnnpackExecutionProvider";
        if (token.includes("wasm")) return "WasmExecutionProvider";
        if (token.includes("cpu")) return "CPUExecutionProvider";
      }
    }
  }
  return undefined;
}

function mapOpenVinoTargetFromRecipe(parsed: unknown): OpenVinoTargetDevice | undefined {
  const systems = (parsed as { systems?: Record<string, unknown> })?.systems;
  if (!systems || typeof systems !== "object") return undefined;
  for (const system of Object.values(systems)) {
    const config = (system as { config?: { accelerators?: unknown[] }; accelerators?: unknown[] })?.config;
    const accelerators = config?.accelerators ?? (system as { accelerators?: unknown[] })?.accelerators;
    if (!Array.isArray(accelerators)) continue;
    for (const accelerator of accelerators) {
      const providers = (accelerator as { execution_providers?: unknown[] })?.execution_providers;
      if (!Array.isArray(providers) || providers.length === 0) continue;
      const token = String(providers[0]).toLowerCase();
      if (!token.includes("openvino")) continue;
      const device = (accelerator as { device?: unknown })?.device;
      return normalizeOpenVinoTargetDevice(device) ?? "CPU";
    }
  }
  return undefined;
}

/**
 * Determines the catalog device label specified by a recipe's execution providers.
 *
 * @returns The matching catalog device label, or `undefined` when no supported provider is found.
 */
export function getCatalogDeviceFromRecipe(parsed: unknown): string | undefined {
  const recipe = parsed as Record<string, unknown> | undefined;
  const systems = recipe?.systems as Record<string, unknown> | undefined;
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
        if (token.includes("webgpu")) return "WebGPU";
        if (token.includes("rocm")) return "CUDA";
        if (token.includes("coreml")) return "CoreML";
        if (token.includes("nnapi")) return "NNAPI";
        if (token.includes("vitisai") || token.includes("vitis-ai") || token.includes("vitis_ai")) {
          return "VitisAI";
        }
        if (token.includes("snpe")) return "SNPE";
        if (token.includes("tflite") || token.includes("tensorflowlite")) return "TFLite";
        if (token.includes("xnnpack")) return "XNNPACK";
        if (token.includes("wasm")) return "WASM";
        if (token.includes("cpu")) return "CPU";
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
    case "QnnAbiExecutionProvider":
      return "QNN";
    case "DmlExecutionProvider":
      return "DirectML";
    case "WebGpuExecutionProvider":
      return "WebGPU";
    case "CoreMLExecutionProvider":
      return "CoreML";
    case "NNAPIExecutionProvider":
      return "NNAPI";
    case "VitisAIExecutionProvider":
      return "VitisAI";
    case "SNPEExecutionProvider":
      return "SNPE";
    case "TensorflowLiteExecutionProvider":
      return "TFLite";
    case "XnnpackExecutionProvider":
      return "XNNPACK";
    case "WasmExecutionProvider":
      return "WASM";
    case "CPUExecutionProvider":
      return "CPU";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/**
 * Compares a catalog item's device label with the device inferred from a recipe.
 *
 * @param item - The catalog item whose device label is compared.
 * @param parsed - The parsed recipe to inspect.
 * @returns The catalog device, inferred recipe device when available, and whether they match.
 */
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

/**
 * Determines the quantization method from a pass type and configuration.
 *
 * @param config - Quantization configuration containing algorithm or mode settings
 * @param passType - Quantization pass type
 * @returns The inferred quantization method
 */
function mapQuantMethod(config: unknown, passType = ""): UIState["passes"]["quantMethod"] {
  const cfg = config as Record<string, unknown>;
  const typeLower = passType.toLowerCase();
  if (typeLower.includes("autoawq")) {
    return "awq";
  }
  if (typeLower.includes("gptq")) return "gptq";
  if (typeLower.includes("spinquant")) return "spinquant";
  if (typeLower.includes("quarot")) return "quarot";
  if (typeLower.includes("hqq")) return "hqq";
  if (typeLower.includes("blockwisertn") || typeLower.includes("rtn")) return "rtn";

  const algorithm = String(cfg.algorithm ?? "").toLowerCase();
  if (algorithm.includes("awq")) return "awq";
  if (algorithm.includes("gptq")) return "gptq";

  const mode = String(cfg.quant_mode ?? cfg.mode ?? "").toLowerCase();
  if (mode.includes("qat") || mode === "qlinearops") {
    return "qat";
  }
  return "ptq";
}

/**
 * Determines the quantization precision represented by a pass configuration.
 *
 * @param config - The pass configuration containing precision-related settings
 * @param passType - The pass type used to identify weight compression formats
 * @returns The inferred quantization precision
 */
function mapQuantPrecision(config: unknown, passType = ""): UIState["passes"]["quantPrecision"] {
  const cfg = config as Record<string, unknown>;
  const typeLower = passType.toLowerCase();
  if (typeLower.includes("weightcompression") || typeLower.includes("nvfp4")) {
    return "int4";
  }
  if (cfg.bits != null) {
    return Number(cfg.bits) <= 4 ? "int4" : "int8";
  }
  if (cfg.quant_level != null) {
    const ql = String(cfg.quant_level).toLowerCase();
    if (ql.includes("w4") || ql.includes("4")) return "int4";
    if (ql.includes("w8") || ql.includes("8")) return "int8";
  }
  const weight = String(cfg.weight_type ?? cfg.precision ?? "int8").toLowerCase();
  if (weight.includes("int4") || weight === "4") return "int4";
  if (weight.includes("fp16") || weight.includes("float16")) return "fp16";
  return "int8";
}

/**
 * Determines the pruning criterion configured for a recipe.
 *
 * @param config - Configuration containing the pruning criterion
 * @returns The normalized pruning criterion, or `undefined` when none is configured
 */
function mapPruningCriteria(config: unknown): "l1_norm" | "l2_norm" | undefined {
  if (!isRecord(config) || !config.pruning_criteria) return undefined;
  return String(config.pruning_criteria).toLowerCase().includes("l2") ? "l2_norm" : "l1_norm";
}

/**
 * Maps Olive recipe passes to the corresponding inactive UI pass state.
 *
 * @param recipePasses - Recipe pass definitions keyed by pass name
 * @returns UI pass state derived from the recognized recipe passes
 */
function mapPassesFromRecipe(recipePasses: Record<string, unknown>): UIState["passes"] {
  const next = createInactivePasses();

  for (const [key, pass] of Object.entries(recipePasses)) {
    if (!pass || typeof pass !== "object") continue;
    const type = String((pass as Record<string, unknown>).type ?? "");
    const rawConfig = (pass as Record<string, unknown>).config;
    const config = isRecord(rawConfig) ? rawConfig : {};
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

/**
 * Derives UI state from an Olive recipe.
 *
 * Extracts model source details, dataset and task metadata, execution provider,
 * memory offload mode, and pass configuration. Speech recognition tasks are
 * normalized to `automatic-speech-recognition`.
 *
 * @param parsed - The parsed Olive recipe.
 * @param options - Options controlling whether mapped passes replace or merge with existing passes.
 * @returns The UI state values derived from the recipe.
 */
export function deriveUiStateFromOliveRecipe(parsed: unknown, options?: DeriveUiStateOptions): Partial<UIState> {
  const recipe = isRecord(parsed) ? parsed : undefined;
  const incomingState: Partial<UIState> = {};
  const inputModel = isRecord(recipe?.input_model) ? recipe.input_model : undefined;
  const icfg = isRecord(inputModel?.config) ? inputModel.config : {};
  const hfConfig = isRecord(icfg.hf_config) ? icfg.hf_config : undefined;
  const hfModelPath =
    typeof inputModel?.model_path === "string"
      ? inputModel.model_path
      : typeof icfg.model_path === "string"
        ? icfg.model_path
        : null;
  const rawModelName = hfConfig?.model_name;
  const hfName =
    typeof rawModelName === "string"
      ? rawModelName
      : typeof hfModelPath === "string"
        ? hfModelPath
        : null;

  if (hfName) {
    incomingState.modelSource = "huggingface";
    incomingState.hfModelId = hfName;
    const dataset =
      (typeof icfg.dataset === "string" && icfg.dataset) ||
      (typeof hfConfig?.dataset === "string" && hfConfig.dataset) ||
      "";
    incomingState.hfDataset = dataset;
    const task =
      (typeof icfg.task === "string" && icfg.task) ||
      (typeof hfConfig?.task === "string" && hfConfig.task) ||
      "";
    incomingState.hfTask = task === "speech-recognition" ? "automatic-speech-recognition" : task;
  }

  const localFiles = icfg.local_files;
  if (isStringArray(localFiles) && localFiles.length > 0) {
    incomingState.modelSource = "local";
    incomingState.localFiles = localFiles.map((name) => ({ name, size: 2_000_000_000 }));
  } else if (icfg.model_path && !hfConfig && !hfModelPath?.includes("/")) {
    incomingState.modelSource = "local";
  }

  if (icfg.model_path && incomingState.modelSource === "azure") {
    incomingState.azureModelPath = String(icfg.model_path);
  } else if (icfg.model_path && !hfConfig && hfModelPath?.includes("azure")) {
    incomingState.modelSource = "azure";
    incomingState.azureModelPath = hfModelPath;
  }

  const provider = mapExecutionProviderFromRecipe(recipe);
  if (provider) {
    incomingState.ihvProvider = provider;
  }
  if (provider === "OpenVINOExecutionProvider") {
    incomingState.openvinoTargetDevice = mapOpenVinoTargetFromRecipe(recipe) ?? "CPU";
  }

  const offloadMode = memoryOffloadFromRecipe(recipe);
  if (offloadMode) {
    incomingState.memoryOffload = offloadMode;
  }

  if (recipe?.passes && isRecord(recipe.passes)) {
    const mapped = mapPassesFromRecipe(recipe.passes);
    if (options?.replacePasses) {
      incomingState.passes = mapped;
      // Clear MCP / prior-run pass overrides so curated/import loads do not
      // inherit stale output_name, dynamic_axes, or calibration settings.
      incomingState.passRecipeOverrides = {};
    } else {
      const base = options?.basePasses ?? DEFAULT_PASSES;
      incomingState.passes = { ...base, ...mapped };
    }
  }

  return incomingState;
}
