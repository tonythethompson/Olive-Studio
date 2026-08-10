import {
  Button,
  Input,
  Label,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui";
import { UIState } from "@/types";
import { LocalFileUpload } from "@/components/features/input/LocalFileUpload";
import type { ConfigTextStatus } from "@/components/features/input/LocalFileUpload";
import type { HfTokenStatus } from "@/components/features/input/useHfToken";
import {
  DownloadCloud,
  KeyRound,
  Search,
  HardDrive,
  Cloud,
  Loader2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

export interface InputModelSourceSectionProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  appliedRecipeLabel: string | null;
  recipeRailCollapsed: boolean;
  sourceConfigExpanded: boolean;
  setSourceConfigExpanded: (v: boolean) => void;
  hfTokenInput: string;
  setHfTokenInput: (v: string) => void;
  hfTokenStatus: HfTokenStatus;
  isTokenMutating: boolean;
  submitTokenMutation: { isPending: boolean };
  clearTokenMutation: { isPending: boolean; isError: boolean };
  handleSubmitToken: () => void;
  handleClearToken: () => void;
  onConfigTextChange: (text: string | undefined, status: ConfigTextStatus) => void;
}

export function InputModelSourceSection({
  state,
  setState,
  appliedRecipeLabel,
  recipeRailCollapsed,
  sourceConfigExpanded,
  setSourceConfigExpanded,
  hfTokenInput,
  setHfTokenInput,
  hfTokenStatus,
  isTokenMutating,
  submitTokenMutation,
  clearTokenMutation,
  handleSubmitToken,
  handleClearToken,
  onConfigTextChange,
}: InputModelSourceSectionProps) {
  return (
    <div className="min-w-0 w-full">
      {!sourceConfigExpanded && !recipeRailCollapsed ? (
        <button
          type="button"
          onClick={() => setSourceConfigExpanded(true)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-3 text-left transition-colors hover:border-electric-blue/40 hover:bg-slate-950/70 cursor-pointer"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
              <DownloadCloud className="h-3.5 w-3.5 text-electric-blue" />
              Configure model source
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Optional custom path: Hugging Face, local files, or Azure ML. Prefer a recipe preset above when you can.
            </p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-slate-400 flex items-center gap-1.5">
              <DownloadCloud className="h-3.5 w-3.5 text-electric-blue" /> Source config
            </h3>
            {!recipeRailCollapsed && (
              <button
                type="button"
                onClick={() => setSourceConfigExpanded(false)}
                className="flex cursor-pointer items-center gap-1 text-[11px] font-mono text-slate-500 hover:text-slate-300"
              >
                <ChevronUp className="h-3 w-3" /> Hide
              </button>
            )}
          </div>

          {appliedRecipeLabel && (
            <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-sm text-slate-300">
              <span className="text-emerald-400 font-semibold">From recipe:</span> {appliedRecipeLabel}
              <span className="text-slate-500"> · </span>
              <span className="font-mono text-xs text-slate-400">
                {state.modelSource === "huggingface" && state.hfModelId
                  ? `HF · ${state.hfModelId}`
                  : state.modelSource === "local"
                    ? `Local · ${state.localFiles.length} file(s)`
                    : state.modelSource === "azure" && state.azureModelPath
                      ? `Azure · ${state.azureModelPath}`
                      : state.modelSource}
              </span>
            </div>
          )}

          <Tabs
            value={state.modelSource}
            onValueChange={(v) => setState({ modelSource: v as UIState["modelSource"] })}
            className="w-full"
          >
            <TabsList className="mb-6 !grid h-auto w-full grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1.5">
              <TabsTrigger value="huggingface" title="Hugging Face Hub" className="w-full rounded-lg px-2 py-2.5 text-xs sm:text-sm">
                <DownloadCloud className="mr-1.5 h-4 w-4 shrink-0" /><span className="truncate">Hugging Face</span>
              </TabsTrigger>
              <TabsTrigger value="local" title="Local Machine" className="w-full rounded-lg px-2 py-2.5 text-xs sm:text-sm">
                <HardDrive className="mr-1.5 h-4 w-4 shrink-0" /><span className="truncate">Local</span>
              </TabsTrigger>
              <TabsTrigger value="azure" title="Azure ML Model" className="w-full rounded-lg px-2 py-2.5 text-xs sm:text-sm">
                <Cloud className="mr-1.5 h-4 w-4 shrink-0" /><span className="truncate">Azure ML</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="huggingface" className="space-y-6 animate-in fade-in">
              <div className="grid gap-3">
                <Label htmlFor="modelId">Hugging Face Model ID</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input id="modelId" placeholder="e.g. meta-llama/Llama-2-7b-hf" className="pl-9" value={state.hfModelId} onChange={(e) => setState({ hfModelId: e.target.value })} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-xs text-slate-500 mr-1">Quick Select:</span>
                  {[
                    { label: "Meta-Llama-3", id: "meta-llama/Meta-Llama-3-8B" },
                    { label: "Phi-3 Mini", id: "microsoft/Phi-3-mini-4k-instruct" },
                    { label: "Whisper Large V3", id: "openai/whisper-large-v3" },
                    { label: "Stable Diffusion XL", id: "stabilityai/stable-diffusion-xl-base-1.0" },
                    { label: "BERT Base", id: "bert-base-uncased" },
                  ].map((m) => (
                    <button key={m.id} type="button" onClick={() => setState({ hfModelId: m.id })} className="text-xs text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer">
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="flex items-center gap-1.5 mb-0">
                    <KeyRound className="h-3.5 w-3.5 text-amber-400" /> HuggingFace Token
                  </Label>
                  {hfTokenStatus === "loading" && <span className="text-[11px] text-slate-500 font-mono">Checking...</span>}
                  {hfTokenStatus === "environment" && <span className="text-[11px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">✓ Found in environment</span>}
                  {hfTokenStatus === "runtime" && <span className="text-[11px] bg-electric-blue/10 border border-electric-blue/20 text-electric-blue px-2 py-0.5 rounded font-mono font-semibold">✓ Set for this session</span>}
                  {hfTokenStatus === "none" && <span className="text-[11px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-mono">Not set — required for gated models</span>}
                  {hfTokenStatus === "error" && <span className="text-[11px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded font-mono">Couldn&apos;t check token status</span>}
                </div>
                {hfTokenStatus !== "environment" && hfTokenStatus !== "loading" && (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input type="password" placeholder="hf_..." autoComplete="off" className="w-full pl-9 pr-3 h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-electric-blue rounded-md font-mono text-sm text-slate-200 placeholder:text-slate-600 outline-none" value={hfTokenInput} onChange={(e) => setHfTokenInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmitToken()} disabled={isTokenMutating} />
                    </div>
                    <Button type="button" onClick={handleSubmitToken} disabled={!hfTokenInput.trim() || isTokenMutating} className="h-9 px-4 text-sm bg-electric-blue hover:bg-electric-blue/90 text-slate-950 font-bold">
                      {submitTokenMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </Button>
                    {hfTokenStatus === "runtime" && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleClearToken}
                        disabled={isTokenMutating}
                        aria-label={clearTokenMutation.isPending ? "Clearing token" : undefined}
                        className="h-9 px-3 text-sm border-red-500/30 text-red-400 hover:bg-red-500/10"
                      >
                        {clearTokenMutation.isPending ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="sr-only">Clearing token</span>
                          </>
                        ) : (
                          "Clear"
                        )}
                      </Button>
                    )}
                  </div>
                )}
                {clearTokenMutation.isError && <p role="alert" className="text-[11px] text-rose-400">Couldn&apos;t clear the token — try again.</p>}
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Stored in server memory only — never written to disk or returned to the client. Set <code className="text-slate-400 font-mono">HF_TOKEN</code> in environment variables for persistent access.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-3">
                  <Label htmlFor="hf-task-type">Task Type</Label>
                  <Select id="hf-task-type" aria-label="Hugging Face task type" value={state.hfTask || ""} onChange={(e) => setState({ hfTask: e.target.value })}>
                    <option value="">Auto (from model id)</option>
                    <option value="text-generation">Text Generation</option>
                    <option value="feature-extraction">Feature Extraction</option>
                    <option value="text-classification">Text Classification</option>
                    <option value="fill-mask">Fill Mask</option>
                    <option value="text2text-generation">Text2Text Generation</option>
                    <option value="automatic-speech-recognition">Automatic Speech Recognition</option>
                    <option value="image-classification">Image Classification</option>
                    <option value="object-detection">Object Detection</option>
                    <option value="sentence-similarity">Sentence Similarity</option>
                    <option value="conversational">Conversational</option>
                  </Select>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Written into Olive <code className="font-mono text-slate-400">input_model.config.task</code>. Embedding models (GTE, BGE, E5) should use Feature Extraction.
                  </p>
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="dataset">Calibration Dataset (Optional)</Label>
                  <Input id="dataset" placeholder="e.g. wikitext" value={state.hfDataset} onChange={(e) => setState({ hfDataset: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="grid gap-3">
                  <Label htmlFor="user-script">User Script Path (Optional)</Label>
                  <Input id="user-script" placeholder="e.g. ./user_script.py" value={state.userScript || ""} onChange={(e) => setState({ userScript: e.target.value || undefined })} />
                  <p className="text-[11px] text-slate-500 leading-relaxed">Path to a Python script with eval/calibration functions required by some optimization passes.</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="local" forceMount className="data-[state=inactive]:hidden animate-in fade-in">
              <LocalFileUpload state={state} setState={setState} onConfigTextChange={onConfigTextChange} />
            </TabsContent>

            <TabsContent value="azure" className="space-y-6 animate-in fade-in">
              <div className="grid gap-3">
                <Label htmlFor="azureModel">Azure ML Workspace Path</Label>
                <div className="relative">
                  <Cloud className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input id="azureModel" placeholder="azureml://subscriptions/.../models/my-model/versions/1" className="pl-9 font-mono text-sm" value={state.azureModelPath} onChange={(e) => setState({ azureModelPath: e.target.value })} />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
