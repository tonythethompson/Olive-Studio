import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { X, FileJson, Check, Copy, Download } from "lucide-react";

export interface ExportRecipeOverlayProps {
  open: boolean;
  onClose: () => void;
  recipe: Record<string, unknown>;
  isCopied: boolean;
  onCopy: () => void;
  onDownload: () => void;
}

/**
 * Full-screen overlay showing the generated Olive recipe JSON with copy and
 * download actions. Rendered on top of the manual execution workspace.
 */
export function ExportRecipeOverlay({
  open,
  onClose,
  recipe,
  isCopied,
  onCopy,
  onDownload,
}: ExportRecipeOverlayProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-55 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in overflow-y-auto">
      <Card className="w-full max-w-2xl border-electric-blue/30 flex flex-col max-h-[85vh]">
        <CardHeader
          title="Export Microsoft Olive Recipe"
          description="Download your dynamic JSON recipe configuration or copy the schema to run with the MS Olive CLI."
          badge={
            <Button
              variant="ghost"
              className="h-8 w-8 p-0 hover:bg-slate-800"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          }
        />
        <CardContent className="flex flex-col gap-4 overflow-hidden flex-1 p-6">
          <div className="flex-1 min-h-[300px] relative flex flex-col overflow-hidden bg-slate-950 border border-slate-800 rounded-lg">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-900 bg-slate-900/40">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-mono text-slate-300">olive_recipe.json</span>
              </div>
              <span className="text-[11px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
                VALID OLIVE SCHEMA
              </span>
            </div>
            <textarea
              readOnly
              className="w-full flex-1 bg-transparent p-4 font-mono text-sm text-emerald-400 focus-visible:outline-none resize-none overflow-y-auto cursor-text"
              value={JSON.stringify(recipe, null, 2)}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
          </div>

          <div className="flex justify-between items-center gap-3 pt-2">
            <span className="text-sm text-slate-500 font-mono hidden sm:inline">
              Generated dynamic recipe mapping
            </span>
            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <Button variant="outline" className="text-sm h-9" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="outline"
                className="text-sm h-9 border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                onClick={onCopy}
              >
                {isCopied ? (
                  <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4 mr-1.5" />
                )}
                {isCopied ? "Copied!" : "Copy to Clipboard"}
              </Button>
              <Button
                variant="default"
                className="text-sm h-9 bg-electric-blue hover:bg-electric-blue/90 text-slate-950"
                onClick={onDownload}
              >
                <Download className="h-4 w-4 mr-1.5" /> Save File (.json)
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
