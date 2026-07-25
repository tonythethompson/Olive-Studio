import { Database, Workflow, Minimize2, Layers, Cpu, Package, Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { UIState } from "@/types";

export function getSelectedModelName(state: UIState): string {
  if (state.modelSource === "huggingface") {
    return state.hfModelId ? state.hfModelId.split("/").pop()! : "No model selected";
  }
  if (state.modelSource === "azure") {
    return state.azureModelPath ? state.azureModelPath.split("/").pop()! : "Asset Container";
  }
  return state.localFiles.length > 0 ? state.localFiles[0].name : "unet_weights.pt";
}

export function getModelSourceSummary(state: UIState): string {
  if (state.modelSource === "huggingface") {
    return state.hfModelId || "No Hugging Face model ID";
  }
  if (state.modelSource === "azure") {
    return state.azureModelPath || "No Azure ML path";
  }
  if (state.localFiles.length > 0) {
    return state.localFiles.map((f) => f.name).join(", ");
  }
  return "No local files selected";
}

export interface NodePreviewData {
  title: string;
  desc: string;
  icon: ReactElement;
  colorTheme: string;
  badge: string;
}

export function getNodePreviewData(state: UIState, nodeId: string): NodePreviewData {
  switch (nodeId) {
    case "input":
      return {
        title: "Base Model Input",
        desc: getSelectedModelName(state),
        icon: <Database className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
        colorTheme: "border-electric-blue/30 text-electric-blue bg-electric-blue/5",
        badge:
          state.modelSource === "huggingface"
            ? "Hugging Face"
            : state.modelSource === "azure"
              ? "AzureML"
              : "Local Folder",
      };
    case "splitting":
      return {
        title: "Model Splitting",
        desc: state.passes.splitting ? "Multi-GPU Partitioning" : "Bypassed Baseline",
        icon: <Workflow className="h-5 w-5 text-amber-500 group-hover:text-amber-400" />,
        colorTheme: state.passes.splitting
          ? "border-amber-500/30 text-amber-500 bg-amber-500/5"
          : "border-slate-800 text-slate-500",
        badge: state.passes.splitting ? "Active" : "Skipped",
      };
    case "peft":
      return {
        title: "PEFT / LoRA Tuning",
        desc: state.passes.peft ? `${state.passes.peftMethod.toUpperCase()} Adapters` : "Bypassed Baseline",
        icon: <Layers className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
        colorTheme: state.passes.peft
          ? "border-electric-blue/30 text-electric-blue bg-electric-blue/5"
          : "border-slate-800 text-slate-500",
        badge: state.passes.peft ? "Active" : "Skipped",
      };
    case "conversion":
      return {
        title: "Graph Conversion",
        desc: state.passes.conversion
          ? state.passes.conversionFormat === "onnx"
            ? `ONNX Opset ${state.passes.conversionOpset}`
            : "OpenVINO Engine"
          : "Bypassed Baseline",
        icon: <Workflow className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
        colorTheme: state.passes.conversion
          ? "border-electric-blue/30 text-electric-blue bg-electric-blue/5"
          : "border-slate-800 text-slate-500",
        badge: state.passes.conversion ? "Active.onnx" : "Skipped",
      };
    case "pruning":
      return {
        title: "Sparsity Pruning",
        desc: (() => {
          if (!state.passes.pruning) return "Bypassed Baseline";
          const pct = (state.passes.pruningSparsity * 100).toFixed(0);
          const method = state.passes.pruningMethod;
          const criteriaSuffix =
            method === "magnitude" ? ` · ${state.passes.pruningCriteria === "l2_norm" ? "L2" : "L1"}` : "";
          return `${pct}% (${method}${criteriaSuffix})`;
        })(),
        icon: <Minimize2 className="h-5 w-5 text-amber-500 group-hover:text-amber-400" />,
        colorTheme: state.passes.pruning
          ? "border-amber-500/30 text-amber-500 bg-amber-500/5"
          : "border-slate-800 text-slate-500",
        badge: state.passes.pruning ? "Active" : "Skipped",
      };
    case "transformer_opt":
      return {
        title: "ORT Optimizations",
        desc: state.passes.onnxTransforms ? "Fusion & Fused Kernels" : "Bypassed Baseline",
        icon: <Layers className="h-5 w-5 text-slate-400 group-hover:text-slate-300" />,
        colorTheme: state.passes.onnxTransforms
          ? "border-slate-600/50 text-slate-300 bg-slate-800/40"
          : "border-slate-800 text-slate-500",
        badge: state.passes.onnxTransforms ? "Active" : "Skipped",
      };
    case "quantization":
      return {
        title: "Quantization Target",
        desc: state.passes.quantization
          ? `${state.passes.quantPrecision} (${state.passes.quantMethod.toUpperCase()})`
          : "Bypassed Baseline",
        icon: <Sparkles className="h-5 w-5 text-emerald-400 group-hover:text-emerald-300" />,
        colorTheme: state.passes.quantization
          ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
          : "border-slate-800 text-slate-500",
        badge: state.passes.quantization ? "Active" : "Skipped",
      };
    case "provider":
      return {
        title: "IHV Target Device",
        desc: state.ihvProvider.replace("ExecutionProvider", ""),
        icon: <Cpu className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
        colorTheme: "border-electric-blue/30 text-electric-blue bg-electric-blue/5",
        badge: "Execution Hardware",
      };
    case "output":
    default: {
      let sizeText = "4.2x Comp.";
      if (state.passes.quantization && state.passes.quantPrecision === "int4") sizeText = "7.8x Comp.";
      if (!state.passes.quantization && !state.passes.pruning) sizeText = "Original Ratio";
      return {
        title: "Deployment Artifact",
        desc: "Ready: .zip Package",
        icon: <Package className="h-5 w-5 text-emerald-400 group-hover:text-emerald-300" />,
        colorTheme: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5",
        badge: sizeText,
      };
    }
  }
}
