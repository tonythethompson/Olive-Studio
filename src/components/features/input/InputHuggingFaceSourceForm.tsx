import { Button, Input, Label, Select } from "@/components/ui";
import { Switch } from "@/components/ui/Switch";
import { UIState } from "@/types";
import type { HfTokenStatus } from "@/components/features/input/useHfToken";
import { KeyRound, Search, Loader2, ShieldAlert } from "lucide-react";

const QUICK_SELECT_MODELS = [
  { label: "Meta-Llama-3", id: "meta-llama/Meta-Llama-3-8B" },
  { label: "Phi-3 Mini", id: "microsoft/Phi-3-mini-4k-instruct" },
  { label: "Whisper Large V3", id: "openai/whisper-large-v3" },
  { label: "Stable Diffusion XL", id: "stabilityai/stable-diffusion-xl-base-1.0" },
  { label: "BERT Base", id: "bert-base-uncased" },
] as const;

export interface InputHuggingFaceSourceFormProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  hfTokenInput: string;
  setHfTokenInput: (v: string) => void;
  hfTokenStatus: HfTokenStatus;
  isTokenMutating: boolean;
  submitTokenMutation: { isPending: boolean };
  clearTokenMutation: { isPending: boolean; isError: boolean };
  handleSubmitToken: () => void;
  handleClearToken: () => void;
}

export function InputHuggingFaceSourceForm({
  state,
  setState,
  hfTokenInput,
  setHfTokenInput,
  hfTokenStatus,
  isTokenMutating,
  submitTokenMutation,
  clearTokenMutation,
  handleSubmitToken,
  handleClearToken,
}: InputHuggingFaceSourceFormProps) {
  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="grid gap-3">
        <Label htmlFor="modelId">Hugging Face Model ID</Label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            id="modelId"
            placeholder="e.g. meta-llama/Llama-2-7b-hf"
            className="pl-9"
            value={state.hfModelId}
            onChange={(e) => setState({ hfModelId: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className="text-xs text-slate-500 mr-1">Quick Select:</span>
          {QUICK_SELECT_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setState({ hfModelId: m.id })}
              className="text-xs text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <label className="flex cursor-pointer items-start gap-3" htmlFor="trust-remote-code">
          <input
            id="trust-remote-code"
            type="checkbox"
            checked={state.passes.trustRemoteCode}
            onChange={(e) => setState({ passes: { ...state.passes, trustRemoteCode: e.target.checked } })}
            className="mt-0.5 h-4 w-4 accent-amber-500"
          />
          <span>
            <span className="block text-sm font-medium text-amber-200">Trust remote code</span>
            <span className="mt-1 block text-xs leading-relaxed text-slate-400">
              Enable only after reviewing the model repository. This allows Hugging Face to run repository-provided Python while loading the model.
            </span>
          </span>
        </label>
      </div>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label className="flex items-center gap-1.5 mb-0">
            <KeyRound className="h-3.5 w-3.5 text-amber-400" /> HuggingFace Token
          </Label>
          {hfTokenStatus === "loading" && <span className="text-[11px] text-slate-500 font-mono">Checking...</span>}
          {hfTokenStatus === "environment" && (
            <span className="text-[11px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
              ✓ Found in environment
            </span>
          )}
          {hfTokenStatus === "runtime" && (
            <span className="text-[11px] bg-electric-blue/10 border border-electric-blue/20 text-electric-blue px-2 py-0.5 rounded font-mono font-semibold">
              ✓ Set for this session
            </span>
          )}
          {hfTokenStatus === "none" && (
            <span className="text-[11px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-mono">
              Not set — required for gated models
            </span>
          )}
          {hfTokenStatus === "error" && (
            <span className="text-[11px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded font-mono">
              Couldn&apos;t check token status
            </span>
          )}
        </div>
        {hfTokenStatus !== "environment" && hfTokenStatus !== "loading" && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="password"
                placeholder="hf_..."
                autoComplete="off"
                className="w-full pl-9 pr-3 h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-electric-blue rounded-md font-mono text-sm text-slate-200 placeholder:text-slate-600 outline-none"
                value={hfTokenInput}
                onChange={(e) => setHfTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmitToken()}
                disabled={isTokenMutating}
              />
            </div>
            <Button
              type="button"
              onClick={handleSubmitToken}
              disabled={!hfTokenInput.trim() || isTokenMutating}
              className="h-9 px-4 text-sm bg-electric-blue hover:bg-electric-blue/90 text-slate-950 font-bold"
            >
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
        {clearTokenMutation.isError && (
          <p role="alert" className="text-[11px] text-rose-400">
            Couldn&apos;t clear the token — try again.
          </p>
        )}
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Stored in server memory only — never written to disk or returned to the client. Set{" "}
          <code className="text-slate-400 font-mono">HF_TOKEN</code> in environment variables for persistent access.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="grid gap-3">
          <Label htmlFor="hf-task-type">Task Type</Label>
          <Select
            id="hf-task-type"
            aria-label="Hugging Face task type"
            value={state.hfTask || ""}
            onChange={(e) => setState({ hfTask: e.target.value })}
          >
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
            Written into Olive <code className="font-mono text-slate-400">input_model.config.task</code>. Embedding models
            (GTE, BGE, E5) should use Feature Extraction.
          </p>
        </div>
        <div className="grid gap-3">
          <Label htmlFor="dataset">Calibration Dataset (Optional)</Label>
          <Input
            id="dataset"
            placeholder="e.g. wikitext"
            value={state.hfDataset}
            onChange={(e) => setState({ hfDataset: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <div className="grid gap-3">
          <Label htmlFor="user-script">User Script Path (Optional)</Label>
          <Input
            id="user-script"
            placeholder="e.g. ./user_script.py"
            value={state.userScript || ""}
            onChange={(e) => setState({ userScript: e.target.value || undefined })}
          />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Path to a Python script with eval/calibration functions required by some optimization passes.
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            id="trustRemoteCode"
            aria-label="Trust remote code from the Hugging Face model repository"
            checked={state.passes.trustRemoteCode}
            onCheckedChange={(v) =>
              setState({
                passes: {
                  ...state.passes,
                  trustRemoteCode: v,
                },
              })
            }
          />
          <Label htmlFor="trustRemoteCode" className="flex items-center gap-2 text-sm text-slate-300">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            Trust Remote Code
          </Label>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Required for some Hugging Face models that include custom Python code (e.g. custom architectures or
          tokenizers). Enabling this executes Python from the model repository inside the Olive process on your
          machine; only enable it for repositories you trust. Olive sets{" "}
          <code className="font-mono text-slate-400">trust_remote_code=True</code> when this is enabled.
        </p>
      </div>
    </div>
  );
}
