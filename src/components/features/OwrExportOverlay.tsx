import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import {
  X,
  Globe,
  Laptop,
  Smartphone,
  Cpu,
  Sliders,
  FileCode,
  Copy,
  Check,
  Download,
} from "lucide-react";

export interface OwrExportConfigs {
  ortConfig: Record<string, unknown>;
  manifestConfig: Record<string, unknown>;
  webInitCode: string;
  mobileInitCode: string;
}

export interface OwrExportOverlayProps {
  open: boolean;
  onClose: () => void;
  configs: OwrExportConfigs;
  platform: "web" | "mobile";
  onPlatformChange: (platform: "web" | "mobile") => void;
  selectedFile: "ort_config.json" | "onnx_model_manifest.json" | "web_init.js" | "mobile_init.kt";
  onFileSelect: (file: "ort_config.json" | "onnx_model_manifest.json" | "web_init.js" | "mobile_init.kt") => void;
  threads: string;
  onThreadsChange: (threads: string) => void;
  vramMode: "performance" | "memory";
  onVramModeChange: (mode: "performance" | "memory") => void;
  onDownloadBundle: () => void;
}

export function OwrExportOverlay({
  open,
  onClose,
  configs,
  platform,
  onPlatformChange,
  selectedFile,
  onFileSelect,
  threads,
  onThreadsChange,
  vramMode,
  onVramModeChange,
  onDownloadBundle,
}: OwrExportOverlayProps) {
  const [isOwrCopied, setIsOwrCopied] = useState(false);

  if (!open) return null;

  const { ortConfig, manifestConfig, webInitCode, mobileInitCode } = configs;

  let fileTitle = "";
  let fileContent = "";
  if (selectedFile === "ort_config.json") {
    fileTitle = "ort_config.json";
    fileContent = JSON.stringify(ortConfig, null, 2);
  } else if (selectedFile === "onnx_model_manifest.json") {
    fileTitle = "onnx_model_manifest.json";
    fileContent = JSON.stringify(manifestConfig, null, 2);
  } else if (selectedFile === "web_init.js") {
    fileTitle = "web_init.js";
    fileContent = webInitCode;
  } else {
    fileTitle = "mobile_init.kt";
    fileContent = mobileInitCode;
  }

  const handleCopyActiveCode = () => {
    navigator.clipboard.writeText(fileContent).then(
      () => {
        setIsOwrCopied(true);
        setTimeout(() => setIsOwrCopied(false), 2000);
      },
      () => {
        // Clipboard write failed — silently ignore (e.g. permission denied, non-secure context)
      },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="absolute inset-0 z-55 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in overflow-y-auto"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <Card className="w-full max-w-4xl border-electric-blue/30 flex flex-col max-h-[90vh]">
        <CardHeader
          title="Export for ONNX Runtime (Web/Mobile)"
          description="Package specific metadata configurations, environment session maps, and code initializers for seamless OWR edge deployment."
          badge={
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 p-0 hover:bg-slate-800"
              aria-label="Close OWR export overlay"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          }
        />
        <CardContent className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6 overflow-auto flex-1">
          {/* Left Parameter Panel: Platform Config & Variables */}
          <div className="md:col-span-4 flex flex-col gap-4 border-r border-slate-900/60 pr-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 text-electric-blue" /> Target Platform Runtime
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${platform === "web"
                      ? "bg-electric-blue/15 border-electric-blue/50 text-electric-blue font-semibold"
                      : "bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800"
                      }`}
                    onClick={() => {
                      onPlatformChange("web");
                      if (selectedFile === "mobile_init.kt") {
                        onFileSelect("web_init.js");
                      }
                    }}
                  >
                    <Laptop className="h-5 w-5" />
                    ORT Web
                  </button>
                  <button
                    type="button"
                    className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center justify-center gap-2 transition-all cursor-pointer ${platform === "mobile"
                      ? "bg-electric-blue/15 border-electric-blue/50 text-electric-blue font-semibold"
                      : "bg-slate-950 border-slate-850 text-slate-400 hover:border-slate-800"
                      }`}
                    onClick={() => {
                      onPlatformChange("mobile");
                      if (selectedFile === "web_init.js") {
                        onFileSelect("mobile_init.kt");
                      }
                    }}
                  >
                    <Smartphone className="h-5 w-5" />
                    ORT Mobile
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <Label
                  htmlFor="owr-thread-allocation"
                  className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                >
                  <Cpu className="h-3.5 w-3.5 text-electric-blue" /> Runtime Thread Allocation
                </Label>
                <select
                  id="owr-thread-allocation"
                  aria-label="Runtime thread allocation"
                  value={threads}
                  onChange={(e) => onThreadsChange(e.target.value)}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-sans justify-between text-slate-200 outline-none hover:border-slate-700 cursor-pointer"
                >
                  <option value="1">1 Thread (Battery-safe)</option>
                  <option value="2">2 Threads (Optimized)</option>
                  <option value="4">4 Threads (Standard Core)</option>
                  <option value="8">8 Threads (Performance Rig)</option>
                </select>
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Determines maximum browser/mobile parallel worker operations.
                </span>
              </div>

              <div className="space-y-1.5 pt-2">
                <Label
                  htmlFor="owr-vram-mode"
                  className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"
                >
                  <Sliders className="h-3.5 w-3.5 text-electric-blue" /> VRAM Optimizer Mode
                </Label>
                <select
                  id="owr-vram-mode"
                  aria-label="VRAM optimizer mode"
                  value={vramMode}
                  onChange={(e) => onVramModeChange(e.target.value as "performance" | "memory")}
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 font-sans justify-between text-slate-200 outline-none hover:border-slate-700 cursor-pointer"
                >
                  <option value="performance">Performance Focus (Accelerated)</option>
                  <option value="memory">Memory Conservative (Low-Memory)</option>
                </select>
                <span className="text-[11px] text-slate-400 block leading-tight">
                  Configured to leverage WebGPU execution providers or WASM pipelines.
                </span>
              </div>
            </div>

            <div className="mt-auto pt-4 border-t border-slate-900/60 space-y-2">
              <div className="p-3 rounded-lg bg-electric-blue/5 border border-electric-blue/10 text-[11px] text-slate-400 leading-relaxed font-sans">
                <strong>Olive OWR Cross-compile:</strong> Generates structural session configs mapped
                dynamically to the model's weight format, execution steps, and target drivers.
              </div>
            </div>
          </div>

          {/* Right Interactive Code Viewer */}
          <div className="md:col-span-8 flex flex-col gap-4 overflow-hidden h-full">
            <div className="flex bg-slate-950 p-1 border border-slate-850 rounded-lg overflow-x-auto shrink-0 gap-1 scrollbar-none">
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${selectedFile === "onnx_model_manifest.json"
                  ? "bg-electric-blue text-slate-950 font-medium"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
                onClick={() => onFileSelect("onnx_model_manifest.json")}
              >
                onnx_model_manifest.json
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${selectedFile === "ort_config.json"
                  ? "bg-electric-blue text-slate-950 font-medium"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
                onClick={() => onFileSelect("ort_config.json")}
              >
                ort_config.json
              </button>
              {platform === "web" ? (
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${selectedFile === "web_init.js"
                    ? "bg-electric-blue text-slate-950 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                    }`}
                  onClick={() => onFileSelect("web_init.js")}
                >
                  web_init.js
                </button>
              ) : (
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition-all whitespace-nowrap cursor-pointer ${selectedFile === "mobile_init.kt"
                    ? "bg-electric-blue text-slate-950 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                    }`}
                  onClick={() => onFileSelect("mobile_init.kt")}
                >
                  mobile_init.kt
                </button>
              )}
            </div>

            <div className="flex-1 min-h-[250px] relative flex flex-col overflow-hidden bg-slate-950 border border-slate-850 rounded-lg">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-900 bg-slate-900/40 shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                  <FileCode className="h-4 w-4 text-electric-blue" />
                  <span>{fileTitle}</span>
                </div>
                <span className="text-[10px] bg-electric-blue/10 border border-electric-blue/20 text-electric-blue px-2 py-0.5 rounded font-mono">
                  ORT export
                </span>
              </div>

              <textarea
                readOnly
                id="owr-export-active-file"
                aria-label={`Contents of ${fileTitle}`}
                className="w-full flex-1 bg-transparent p-4 font-mono text-xs text-electric-blue focus-visible:outline-none resize-none overflow-y-auto cursor-text whitespace-pre bg-transparent select-text"
                value={fileContent}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>

            <div className="flex justify-between items-center gap-3 pt-2 shrink-0">
              <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                Includes boilerplate loaders & execution environment configs
              </span>
              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <Button
                  variant="outline"
                  className="text-xs h-9"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  className="text-xs h-9 border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                  onClick={handleCopyActiveCode}
                >
                  {isOwrCopied ? (
                    <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1.5" />
                  )}
                  {isOwrCopied ? "Copied!" : "Copy Active File"}
                </Button>
                <Button
                  variant="default"
                  className="text-xs h-9 bg-electric-blue hover:bg-electric-blue-dark text-slate-950 font-bold"
                  onClick={onDownloadBundle}
                >
                  <Download className="h-4 w-4 mr-1.5" /> Download Bundle (.zip)
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
