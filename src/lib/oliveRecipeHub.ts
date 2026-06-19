import { UIState, IHVProvider } from "@/types";

export const OLIVE_RECIPES_REPO = "microsoft/olive-recipes";
export const OLIVE_RECIPES_BRANCH = "main";

export interface RecipeCatalogItem {
  name: string;
  architecture: string;
  device: string;
  repoPath: string;
  description: string;
}

export interface ParsedGitHubTarget {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export function parseGitHubRecipeTarget(
  repoInput: string,
  branchInput: string,
  pathInput: string
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

  let cleanRepo = trimmed
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
  pathInput: string
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
  branch = OLIVE_RECIPES_BRANCH
): Promise<unknown> {
  const { json } = await fetchGitHubRecipeJson(repo, branch, item.repoPath);
  return json;
}

function mapExecutionProviderFromRecipe(parsed: any): IHVProvider | undefined {
  const systems = parsed?.systems;
  if (systems && typeof systems === "object") {
    for (const system of Object.values(systems)) {
      const accelerators = (system as any)?.accelerators;
      if (!Array.isArray(accelerators)) continue;
      for (const accelerator of accelerators) {
        const providers = accelerator?.execution_providers;
        if (!Array.isArray(providers) || providers.length === 0) continue;
        const token = String(providers[0]).toLowerCase();
        if (token.includes("cuda")) return "CUDAExecutionProvider";
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

export function deriveUiStateFromOliveRecipe(parsed: any, currentPasses?: UIState["passes"]): Partial<UIState> {
  const incomingState: Partial<UIState> = {};
  const inputModel = parsed?.input_model;

  const hfConfig = inputModel?.config?.hf_config;
  const hfModelPath = typeof inputModel?.model_path === "string" ? inputModel.model_path : null;
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

  const provider = mapExecutionProviderFromRecipe(parsed);
  if (provider) {
    incomingState.ihvProvider = provider;
  }

  if (parsed?.passes && currentPasses) {
    const next: UIState["passes"] = { ...currentPasses };

    if (parsed.passes.conversion) {
      next.conversion = true;
      if (parsed.passes.conversion.config?.target_opset) {
        next.conversionOpset = parsed.passes.conversion.config.target_opset;
      }
      if (parsed.passes.conversion.config?.precision) {
        next.conversionInputTargetTypes = parsed.passes.conversion.config.precision;
      }
    }

    if (parsed.passes.quantization) {
      next.quantization = true;
      if (parsed.passes.quantization.config?.weight_type) {
        next.quantPrecision = parsed.passes.quantization.config.weight_type;
      }
    }

    if (parsed.passes.pruning) {
      next.pruning = true;
      if (parsed.passes.pruning.config?.sparsity) {
        next.pruningSparsity = parsed.passes.pruning.config.sparsity;
      }
    }

    if (parsed.passes.peft || parsed.passes.builder) {
      if (parsed.passes.peft) next.peft = true;
      if (parsed.passes.builder) next.conversion = true;
    }

    if (
      parsed.passes.transformers_optimization ||
      parsed.passes.transformer_opt ||
      Object.values(parsed.passes).some((pass: any) =>
        String(pass?.type || "").toLowerCase().includes("transform")
      )
    ) {
      next.onnxTransforms = true;
    }

    incomingState.passes = next;
  }

  return incomingState;
}
