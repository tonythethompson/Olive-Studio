/**
 * GitHubRecipeSync — GitHub tab for fetching Olive recipes from remote repositories.
 * Extracted from InputEnvironmentPanel (Task 5).
 */
import { Input, Label, Button } from "@/components/ui";
import { SUGGESTED_RECIPES } from "@/data/recipes";
import {
  OLIVE_RECIPES_BRANCH,
  OLIVE_RECIPES_REPO,
} from "@/lib/oliveRecipeHub";
import {
  Globe,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

export interface GitHubRecipeSyncProps {
  repoUrl: string;
  setRepoUrl: (v: string) => void;
  repoBranch: string;
  setRepoBranch: (v: string) => void;
  repoPath: string;
  setRepoPath: (v: string) => void;
  syncStatus: string;
  syncError: string;
  handleFetchRemote: (opts?: { url: string; branch: string; path: string }) => Promise<void>;
}

export function GitHubRecipeSync({
  repoUrl,
  setRepoUrl,
  repoBranch,
  setRepoBranch,
  repoPath,
  setRepoPath,
  syncStatus,
  syncError,
  handleFetchRemote,
}: GitHubRecipeSyncProps) {
  const pathSuggestions = SUGGESTED_RECIPES.filter((item) => {
    if (!repoPath.trim()) return true;
    return item.repoPath.toLowerCase().includes(repoPath.toLowerCase());
  }).slice(0, 40);

  const shortcuts = [
    {
      label: "Qwen2.5 TRT-RTX FP16",
      repo: `https://github.com/${OLIVE_RECIPES_REPO}`,
      branch: OLIVE_RECIPES_BRANCH,
      path: "Qwen-Qwen2.5-1.5B-Instruct/NvTensorRtRtx/Qwen2.5-1.5B-Instruct_model_builder_fp16.json",
    },
    {
      label: "Whisper Tiny CPU INT8",
      repo: `https://github.com/${OLIVE_RECIPES_REPO}`,
      branch: OLIVE_RECIPES_BRANCH,
      path: "openai-whisper-tiny/cpu/whisper-tiny_cpu_int8.json",
    },
    {
      label: "Phi-3.5 Mini DirectML",
      repo: `https://github.com/${OLIVE_RECIPES_REPO}`,
      branch: OLIVE_RECIPES_BRANCH,
      path: "microsoft-Phi-3.5-mini-instruct/aitk/phi3_5_dml_config.json",
    },
    {
      label: "ResNet PTQ (olive repo)",
      repo: "https://github.com/microsoft/olive",
      branch: "main",
      path: "examples/resnet/resnet_ptq.json",
    },
  ];

  return (
    <div className="space-y-3 bg-slate-950/30 p-3 rounded-xl border border-slate-900 max-h-[420px] overflow-y-auto">
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 text-electric-blue" />
          GitHub Repository URL (Public)
        </Label>
        <Input
          placeholder="e.g. microsoft/olive"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className="font-mono text-sm h-9"
        />
        <p className="text-[11px] text-slate-550">
          Supports direct link format or path parsing.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-electric-blue" />
            Target Branch
          </Label>
          <Input
            value={repoBranch}
            onChange={(e) => setRepoBranch(e.target.value)}
            className="font-mono text-sm h-9"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <GitPullRequest className="h-3.5 w-3.5 text-pink-400" />
            Recipe Path
          </Label>
          <Input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            className="font-mono text-sm h-9"
            list="olive-recipe-paths"
          />
          <datalist id="olive-recipe-paths">
            {pathSuggestions.map((item) => (
              <option key={item.repoPath} value={item.repoPath}>
                {item.name}
              </option>
            ))}
          </datalist>
        </div>
      </div>

      <Button
        type="button"
        onClick={() => void handleFetchRemote()}
        disabled={syncStatus === "loading" || !repoUrl.trim()}
        className="w-full text-sm h-9 bg-electric-blue hover:bg-electric-blue-dark text-slate-950"
      >
        {syncStatus === "loading" ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin text-white" />
            Synchronizing...
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Pull from GitHub
          </>
        )}
      </Button>

      {syncStatus === "error" && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{syncError}</span>
        </div>
      )}

      <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-slate-500 block pt-2 border-t border-slate-900">
        Microsoft Olive shortcuts
      </span>
      <div className="grid grid-cols-1 gap-2">
        {shortcuts.map((sc) => {
          const isActive =
            repoPath === sc.path &&
            repoBranch === sc.branch &&
            (repoUrl.includes("olive-recipes")
              ? sc.repo.includes("olive-recipes")
              : repoUrl.replace(/\/$/, "") === sc.repo.replace(/\/$/, ""));
          return (
            <button
              key={sc.path}
              type="button"
              disabled={syncStatus === "loading"}
              aria-label={`Pull ${sc.label} into JSON editor`}
              onClick={() => {
                void handleFetchRemote({
                  url: sc.repo,
                  branch: sc.branch,
                  path: sc.path,
                });
              }}
              className={`text-left p-2.5 rounded-lg text-sm transition-all font-sans cursor-pointer group disabled:opacity-50 disabled:cursor-wait border ${
                isActive
                  ? "bg-electric-blue/10 border-electric-blue/40 text-slate-100"
                  : "bg-slate-950/80 hover:bg-slate-950 border-slate-900 hover:border-electric-blue/20 text-slate-300"
              }`}
            >
              <span
                className={`font-semibold block transition-colors ${
                  isActive
                    ? "text-electric-blue"
                    : "text-slate-200 group-hover:text-electric-blue"
                }`}
              >
                {sc.label}
                {syncStatus === "loading" && repoPath === sc.path ? " · pulling…" : ""}
              </span>
              <span className="text-[11px] text-slate-500 block truncate font-mono mt-0.5">
                {sc.path}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
