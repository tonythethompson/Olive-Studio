/**
 * RecipeJsonEditor — JSON editor tab for pasting/importing raw Olive recipe JSON.
 * Extracted from InputEnvironmentPanel (Task 5).
 */
import { Button } from "@/components/ui";
import { AlertTriangle, FileJson } from "lucide-react";

export interface RecipeJsonEditorProps {
  importJson: string;
  setImportJson: (v: string) => void;
  importError: string | null;
  setImportError: (v: string | null) => void;
  handleImport: (force: boolean) => void;
}

export function RecipeJsonEditor({
  importJson,
  setImportJson,
  importError,
  setImportError,
  handleImport,
}: RecipeJsonEditorProps) {
  return (
    <div className="flex flex-col gap-3">
      {importError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm font-mono leading-relaxed flex items-start gap-1.5 animate-bounce">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{importError}</span>
        </div>
      )}

      <div className="relative flex flex-col min-h-[180px]">
        <textarea
          className="w-full flex-1 bg-slate-950 border border-slate-900 hover:border-slate-800 focus:border-electric-blue rounded-lg p-3 font-mono text-xs text-slate-300 focus-visible:outline-none focus:focus-visible:ring-1 focus-visible:ring-electric-blue/40 placeholder:text-slate-700 resize-none h-[180px]"
          placeholder={`{\n  "input_model": {\n    "type": "PyTorchModel",\n    "config": {\n      "hf_config": {\n        "model_name": "meta-llama/Meta-Llama-3-8B"\n      }\n    }\n  },\n  "passes": {\n    "conversion": { "type": "OnnxConversion" }\n  }\n}`}
          value={importJson}
          onChange={(e) => {
            setImportJson(e.target.value);
            if (importError) setImportError(null);
          }}
        />
      </div>

      <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center bg-slate-950 px-4 py-3 border border-slate-900 rounded-lg gap-2">
        <span className="text-[11px] text-slate-500 font-mono sm:mr-auto">
          Paste raw Olive JSON format schema above or load standard presets
        </span>
        <Button
          type="button"
          variant="outline"
          onClick={() => handleImport(true)}
          disabled={!importJson.trim()}
          className="text-sm h-8 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
        >
          Apply anyway
        </Button>
        <Button
          type="button"
          onClick={() => handleImport(false)}
          disabled={!importJson.trim()}
          className="text-sm h-8 bg-electric-blue hover:bg-electric-blue-dark text-slate-950 cursor-pointer"
        >
          <FileJson className="h-3.5 w-3.5 mr-1.5" />
          Parse & Apply Configuration
        </Button>
      </div>
    </div>
  );
}
