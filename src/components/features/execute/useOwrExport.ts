import { useState, useMemo } from "react";
import { type UIState } from "@/types";
import { buildOwrConfigs } from "@/lib/owrExportConfigs";
import type { OwrExportConfigs } from "./OwrExportOverlay";

export type OwrPlatform = "web" | "mobile";
export type OwrVramMode = "performance" | "memory";
export type OwrSelectedFile = "ort_config.json" | "onnx_model_manifest.json" | "web_init.js" | "mobile_init.kt";

export interface UseOwrExportOptions {
  state: UIState;
}

export interface UseOwrExportReturn {
  isOwrExportOpen: boolean;
  setIsOwrExportOpen: (open: boolean) => void;
  owrConfigs: OwrExportConfigs;
  owrPlatform: OwrPlatform;
  setOwrPlatform: (platform: OwrPlatform) => void;
  owrSelectedFile: OwrSelectedFile;
  setOwrSelectedFile: (file: OwrSelectedFile) => void;
  owrThreads: string;
  setOwrThreads: (threads: string) => void;
  owrVramMode: OwrVramMode;
  setOwrVramMode: (mode: OwrVramMode) => void;
  owrDownloadError: string | null;
  isOwrDownloading: boolean;
  handleDownloadOwrBundle: () => Promise<void>;
}

/**
 * Owns the ONNX Runtime Web/Mobile (OWR) export overlay state, config building,
 * and bundle download logic.
 */
export function useOwrExport({ state }: UseOwrExportOptions): UseOwrExportReturn {
  const [isOwrExportOpen, setIsOwrExportOpen] = useState(false);
  const [owrPlatform, setOwrPlatform] = useState<OwrPlatform>("web");
  const [owrThreads, setOwrThreads] = useState("4");
  const [owrVramMode, setOwrVramMode] = useState<OwrVramMode>("performance");
  const [owrSelectedFile, setOwrSelectedFile] = useState<OwrSelectedFile>("ort_config.json");
  const [owrDownloadError, setOwrDownloadError] = useState<string | null>(null);
  const [isOwrDownloading, setIsOwrDownloading] = useState(false);

  const owrConfigs = useMemo(
    () =>
      buildOwrConfigs({
        state,
        platform: owrPlatform,
        threads: owrThreads,
        vramMode: owrVramMode,
      }),
    [state, owrPlatform, owrThreads, owrVramMode],
  );

  const handleDownloadOwrBundle = async () => {
    if (isOwrDownloading) return;
    setIsOwrDownloading(true);
    try {
      setOwrDownloadError(null);
      const { ortConfig, manifestConfig, webInitCode, mobileInitCode } = owrConfigs;
      const rawModelId = state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "model";
      const modelName = rawModelId.split("/").pop() || "model";

      let zipData: Uint8Array;
      let zipSync: typeof import("fflate").zipSync;
      let strToU8: typeof import("fflate").strToU8;
      try {
        ({ zipSync, strToU8 } = await import("fflate"));
      } catch (e) {
        console.error("Failed to load ZIP module", e);
        setOwrDownloadError("Couldn't load the ZIP module. Check your connection and try again.");
        return;
      }

      try {
        const files: Record<string, Uint8Array> = {};
        files["ort_config.json"] = strToU8(JSON.stringify(ortConfig, null, 2));
        files["onnx_model_manifest.json"] = strToU8(JSON.stringify(manifestConfig, null, 2));

        if (owrPlatform === "web") {
          files["web_init.js"] = strToU8(webInitCode);
        } else {
          files["mobile_init.kt"] = strToU8(mobileInitCode);
        }

        const readme = `ONNX Runtime Web/Mobile (OWR) Deployment Bundle
  ==================================================
  Created: ${new Date().toLocaleString()}
  Target Environment: ONNX Runtime ${owrPlatform === "web" ? "Web (WebGPU/WASM)" : "Mobile (Android/iOS)"}
  Optimized Model: ${modelName}

  Contents of this bundle:
  1. onnx_model_manifest.json - Full optimization and pipeline conversion audit trail from MS Olive.
  2. ort_config.json - Direct configuration rules for loading the model session dynamically.
  3. ${owrPlatform === "web" ? "web_init.js" : "mobile_init.kt"} - Boilerplate initialization and execution patterns.

  Deployment Steps:
  ${owrPlatform === "web"
            ? "- Place the optimized model file (model.onnx) in your public asset folder.\\n- Install 'onnxruntime-web' dependency using pnpm.\\n- Import and invoke your customized initializeOrtSession() function. "
            : "- Place the compiled ORT flatbuffer file (model.ort) under your Android App's 'src/main/assets' directory.\\n- Implement 'ai.onnxruntime:onnxruntime-android' via gradle.\\n- Wire up your OnnxModelExecutor wrapper inside Activities/Handlers."
          }
  `;
        files["README.txt"] = strToU8(readme);

        zipData = zipSync(files);
      } catch (e) {
        console.error("Archive generation failed", e);
        setOwrDownloadError("Failed to create the ZIP archive. Check the browser console for details.");
        return;
      }

      try {
        const content = new Blob([zipData as unknown as ArrayBuffer], { type: "application/zip" });
        const url = URL.createObjectURL(content);
        const link = document.createElement("a");
        link.href = url;
        const modelCleanName = modelName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
        link.download = `owr_bundle_${owrPlatform}_${modelCleanName}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error("ZIP Generation failed", e);
        setOwrDownloadError("ZIP generation failed. Try again, or check the browser console for details.");
      }
    } finally {
      setIsOwrDownloading(false);
    }
  };

  return {
    isOwrExportOpen,
    setIsOwrExportOpen,
    owrConfigs,
    owrPlatform,
    setOwrPlatform,
    owrSelectedFile,
    setOwrSelectedFile,
    owrThreads,
    setOwrThreads,
    owrVramMode,
    setOwrVramMode,
    owrDownloadError,
    isOwrDownloading,
    handleDownloadOwrBundle,
  };
}
