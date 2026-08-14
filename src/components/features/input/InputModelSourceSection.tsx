import { useState } from "react";
import { Input, Label, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { UIState } from "@/types";
import { cn } from "@/lib/utils";
import { LocalFileUpload, type ConfigTextStatus } from "@/components/features/input/LocalFileUpload";
import type { HfTokenStatus } from "@/components/features/input/useHfToken";
import { InputHuggingFaceSourceForm } from "@/components/features/input/InputHuggingFaceSourceForm";
import { DownloadCloud, HardDrive, Cloud, ChevronUp, ChevronDown } from "lucide-react";

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

function AppliedRecipeBanner({
  appliedRecipeLabel,
  state,
}: {
  appliedRecipeLabel: string;
  state: UIState;
}) {
  return (
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
  );
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
  const isSourceCollapsed = !sourceConfigExpanded && !recipeRailCollapsed;
  // Promote during render: the initializer only runs on mount. If we start
  // collapsed, the first expand must latch so LocalFileUpload (and its File
  // object map) stays mounted after Hide.
  const [keepSourceMounted, setKeepSourceMounted] = useState(
    () => sourceConfigExpanded || recipeRailCollapsed,
  );
  if ((sourceConfigExpanded || recipeRailCollapsed) && !keepSourceMounted) {
    setKeepSourceMounted(true);
  }
  const shouldKeepSourceMounted = keepSourceMounted || sourceConfigExpanded || recipeRailCollapsed;

  return (
    <div className="min-w-0 w-full">
      {isSourceCollapsed && (
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
      )}

      {shouldKeepSourceMounted && (
      <div className={cn(isSourceCollapsed && "hidden")}>
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
        <AppliedRecipeBanner appliedRecipeLabel={appliedRecipeLabel} state={state} />
      )}

      <Tabs
        value={state.modelSource}
        onValueChange={(v) => setState({ modelSource: v as UIState["modelSource"] })}
        className="w-full"
      >
        <TabsList className="mb-6 !grid h-auto w-full grid-cols-1 sm:grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1.5">
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

        <TabsContent value="huggingface">
          <InputHuggingFaceSourceForm
            state={state}
            setState={setState}
            hfTokenInput={hfTokenInput}
            setHfTokenInput={setHfTokenInput}
            hfTokenStatus={hfTokenStatus}
            isTokenMutating={isTokenMutating}
            submitTokenMutation={submitTokenMutation}
            clearTokenMutation={clearTokenMutation}
            handleSubmitToken={handleSubmitToken}
            handleClearToken={handleClearToken}
          />
        </TabsContent>

        <TabsContent value="local" forceMount className="data-[state=inactive]:hidden animate-in fade-in">
          <LocalFileUpload state={state} setState={setState} onConfigTextChange={onConfigTextChange} />
        </TabsContent>

        <TabsContent value="azure" className="space-y-6 animate-in fade-in">
          <div className="grid gap-3">
            <Label htmlFor="azureModel">Azure ML Workspace Path</Label>
            <div className="relative">
              <Cloud className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                id="azureModel"
                placeholder="azureml://subscriptions/.../models/my-model/versions/1"
                className="pl-9 font-mono text-sm"
                value={state.azureModelPath}
                onChange={(e) => setState({ azureModelPath: e.target.value })}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
      </div>
      )}
    </div>
  );
}
