import { useState } from "react";
import { Card, CardContent, CardHeader, Select, Label, Switch, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui";
import { IHVProvider, UIState } from "@/types";
import { Cpu, CpuIcon, Layers, Settings2, AlertTriangle, ShieldAlert, Check, Wand2, Activity, Lock, CheckCircle, AlertCircle, Info, Search, Sliders, Table, List, Sparkles } from "lucide-react";

interface HardwareConflict {
  passKey: string;
  passName: string;
  reason: string;
  severity: "critical" | "warning";
  autofix: () => Partial<UIState["passes"]>;
}

export function getProviderConflicts(providerId: IHVProvider, passes: UIState["passes"]): HardwareConflict[] {
  const conflicts: HardwareConflict[] = [];

  switch (providerId) {
    case "CPUExecutionProvider":
      if (passes.conversion && passes.conversionFormat === "openvino") {
        conflicts.push({
          passKey: "conversionFormat",
          passName: "OpenVINO Format",
          reason: "Intel OpenVINO IR format requires OpenVINO Execution Provider.",
          severity: "warning",
          autofix: () => ({ ...passes, conversionFormat: "onnx" }),
        });
      }
      if (passes.quantization && passes.quantMethod === "awq") {
        conflicts.push({
          passKey: "quantMethod",
          passName: "AWQ Quantization",
          reason: "AWQ requires specialized CUDA/ROCm execution kernels on GPU.",
          severity: "critical",
          autofix: () => ({ ...passes, quantMethod: "ptq" }),
        });
      }
      if (passes.pruning && passes.pruningType === "structured") {
        conflicts.push({
          passKey: "pruningType",
          passName: "Structured Sparsity",
          reason: "2:4 Structured Sparsity requires hardware-level NVIDIA Tensor Cores.",
          severity: "warning",
          autofix: () => ({ ...passes, pruningType: "unstructured" }),
        });
      }
      if (passes.peft && passes.peftMethod === "qlora") {
        conflicts.push({
          passKey: "peftMethod",
          passName: "QLoRA Tuning",
          reason: "Quantized PEFT fine-tuning expects specialized GPU CUDA kernels. Extremely slow on CPU.",
          severity: "warning",
          autofix: () => ({ ...passes, peftMethod: "lora" }),
        });
      }
      break;

    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
      if (passes.conversion && passes.conversionFormat === "openvino") {
        conflicts.push({
          passKey: "conversionFormat",
          passName: "OpenVINO Format",
          reason: "NVIDIA GPUs utilize standard ONNX models, not OpenVINO IR representation.",
          severity: "critical",
          autofix: () => ({ ...passes, conversionFormat: "onnx" }),
        });
      }
      break;

    case "OpenVINOExecutionProvider":
      if (passes.quantization && passes.quantMethod === "awq") {
        conflicts.push({
          passKey: "quantMethod",
          passName: "AWQ Quantization",
          reason: "AWQ is highly specific to CUDA/ROCm APIs and is not supported by OpenVINO.",
          severity: "critical",
          autofix: () => ({ ...passes, quantMethod: "ptq" }),
        });
      }
      if (passes.pruning && passes.pruningType === "structured") {
        conflicts.push({
          passKey: "pruningType",
          passName: "Structured Sparsity",
          reason: "2:4 Structured Sparsity requires hardware-level NVIDIA Tensor Cores.",
          severity: "warning",
          autofix: () => ({ ...passes, pruningType: "unstructured" }),
        });
      }
      if (passes.peft) {
        conflicts.push({
          passKey: "peft",
          passName: "PEFT / LoRA Training",
          reason: "Parameter-Efficient Fine-Tuning is designed for CUDA hosts. Intel NPU target is for optimized inference.",
          severity: "warning",
          autofix: () => ({ ...passes, peft: false }),
        });
      }
      break;

    case "QNNExecutionProvider":
      if (passes.conversion && passes.conversionFormat === "openvino") {
        conflicts.push({
          passKey: "conversionFormat",
          passName: "OpenVINO Format",
          reason: "Qualcomm Snapdragon NPU requires ONNX format, not Intel OpenVINO IR.",
          severity: "critical",
          autofix: () => ({ ...passes, conversionFormat: "onnx" }),
        });
      }
      if (passes.quantization && (passes.quantMethod === "awq" || passes.quantMethod === "qat")) {
        conflicts.push({
          passKey: "quantMethod",
          passName: "AWQ / QAT Quantization",
          reason: "Snapdragon NPUs require standard Post-Training Static/Dynamic Quantization (PTQ).",
          severity: "critical",
          autofix: () => ({ ...passes, quantMethod: "ptq" }),
        });
      }
      if (passes.pruning && passes.pruningType === "structured") {
        conflicts.push({
          passKey: "pruningType",
          passName: "Structured Sparsity",
          reason: "Qualcomm Snapdragon NPUs do not support hardware-level 2:4 structured sparsity acceleration.",
          severity: "warning",
          autofix: () => ({ ...passes, pruningType: "unstructured" }),
        });
      }
      if (passes.peft) {
        conflicts.push({
          passKey: "peft",
          passName: "PEFT / LoRA Training",
          reason: "Snapdragon edge targets are optimized for low-power execution, not active training loops.",
          severity: "critical",
          autofix: () => ({ ...passes, peft: false }),
        });
      }
      break;

    case "ROCMExecutionProvider":
      if (passes.conversion && passes.conversionFormat === "openvino") {
        conflicts.push({
          passKey: "conversionFormat",
          passName: "OpenVINO Format",
          reason: "AMD GPUs utilize standard ONNX models, not Intel OpenVINO IR.",
          severity: "critical",
          autofix: () => ({ ...passes, conversionFormat: "onnx" }),
        });
      }
      if (passes.pruning && passes.pruningType === "structured") {
        conflicts.push({
          passKey: "pruningType",
          passName: "Structured Sparsity",
          reason: "2:4 Structured Sparsity requires proprietary NVIDIA Tensor Core hardware.",
          severity: "warning",
          autofix: () => ({ ...passes, pruningType: "unstructured" }),
        });
      }
      break;

    default:
      break;
  }

  return conflicts;
}

const providers: { id: IHVProvider; name: string; desc: string; icon: any }[] = [
  { id: "CPUExecutionProvider", name: "Native CPU", desc: "Standard ONNX Runtime CPU Provider for broad compatibility.", icon: Cpu },
  { id: "CUDAExecutionProvider", name: "NVIDIA CUDA / TensorRT", desc: "Accelerates deep learning inference on NVIDIA GPUs.", icon: Layers },
  { id: "OpenVINOExecutionProvider", name: "Intel OpenVINO", desc: "Optimized for Intel architectures (Core, Xeon, Core Ultra).", icon: CpuIcon },
  { id: "QNNExecutionProvider", name: "Qualcomm QNN (Snapdragon)", desc: "Leverage Qualcomm Hexagon NPUs on edge and mobile devices.", icon: CpuIcon },
  { id: "ROCMExecutionProvider", name: "AMD ROCm", desc: "High-performance compute provider for AMD GPUs.", icon: Layers },
];

interface OptimizationPassValidation {
  id: string;
  name: string;
  category: "Conversion" | "Quantization" | "Compression" | "PEFT";
  description: string;
  isUnsupported: (provider: IHVProvider) => boolean;
  getIncompatibilityReason: (provider: IHVProvider) => string;
  isActive: (passes: UIState["passes"]) => boolean;
  toggle: (passes: UIState["passes"], currentActive: boolean) => Partial<UIState["passes"]>;
  requiresExplanation: string;
}

const validations: OptimizationPassValidation[] = [
  {
    id: "openvino-format",
    name: "OpenVINO IR Conversion Stage",
    category: "Conversion",
    description: "Compiles standard execution graphs into the highly optimized Intel OpenVINO XML/BIN Intermediate Representation.",
    isUnsupported: (provider) => provider !== "OpenVINOExecutionProvider",
    getIncompatibilityReason: () => "Requires Intel OpenVINO hardware target.",
    isActive: (passes) => passes.conversion && passes.conversionFormat === "openvino",
    toggle: (passes, active) => active ? { ...passes, conversionFormat: "onnx" } : { ...passes, conversion: true, conversionFormat: "openvino" },
    requiresExplanation: "Standard CPU, NVIDIA Titan/GeForce/RTX, Qualcomm Snapdragon, and AMD hosts expect standard ONNX models instead of proprietary Intel IR files."
  },
  {
    id: "awq-quantization",
    name: "AWQ Activation-Aware Quantization",
    category: "Quantization",
    description: "Protects high-salient channel weights dynamically from rounding errors, protecting baseline math precision.",
    isUnsupported: (provider) => !["CUDAExecutionProvider", "TensorrtExecutionProvider", "ROCMExecutionProvider"].includes(provider),
    getIncompatibilityReason: () => "Requires NVIDIA/AMD high-performance compute host.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "awq",
    toggle: (passes, active) => active ? { ...passes, quantMethod: "ptq" } : { ...passes, quantization: true, quantMethod: "awq" },
    requiresExplanation: "AWQ is fine-tuned for heavy linear layers utilizing specialized CUDA or ROCm GPU acceleration matrices."
  },
  {
    id: "qat-quantization",
    name: "Quantization-Aware Training (QAT)",
    category: "Quantization",
    description: "Instruments training backpropagation to emulate integer quantization noise, producing highly robust integer models.",
    isUnsupported: (provider) => provider === "QNNExecutionProvider",
    getIncompatibilityReason: () => "Snapdragon NPU does not support active QAT pipelines.",
    isActive: (passes) => passes.quantization && passes.quantMethod === "qat",
    toggle: (passes, active) => active ? { ...passes, quantMethod: "ptq" } : { ...passes, quantization: true, quantMethod: "qat" },
    requiresExplanation: "Qualcomm Snapdragon Hexagon NPUs require standard offline Post-Training Quantization (PTQ) formats to run properly."
  },
  {
    id: "structured-sparsity",
    name: "Structured 2:4 Sparsity Pruning",
    category: "Compression",
    description: "Systematically zeros out 2 out of every 4 block elements to maximize memory access efficiency.",
    isUnsupported: (provider) => !["CUDAExecutionProvider", "TensorrtExecutionProvider"].includes(provider),
    getIncompatibilityReason: () => "Requires built-in NVIDIA Ampere+ Tensor Cores.",
    isActive: (passes) => passes.pruning && passes.pruningType === "structured",
    toggle: (passes, active) => active ? { ...passes, pruningType: "unstructured" } : { ...passes, pruning: true, pruningType: "structured" },
    requiresExplanation: "2:4 block sparsity requires built-in hardware decoding logic integrated exclusively into modern NVIDIA RTX or enterprise datacenter GPUs."
  },
  {
    id: "peft-adapters",
    name: "PEFT LoRA Training Stage",
    category: "PEFT",
    description: "Locks core parameters to fine-tune compact rank-adapters, drastically boosting training speed and reducing VRAM footprint.",
    isUnsupported: (provider) => ["QNNExecutionProvider", "OpenVINOExecutionProvider"].includes(provider),
    getIncompatibilityReason: () => "NPUs are strictly optimized for static low-power inference.",
    isActive: (passes) => passes.peft,
    toggle: (passes, active) => active ? { ...passes, peft: false } : { ...passes, peft: true },
    requiresExplanation: "Edge-facing Snapdragon or Intel NPU architectures cannot execute full training loops. Adapter configurations must be compiled on CPU/GPU."
  },
  {
    id: "qlora-adapters",
    name: "Double-Quantized QLoRA Adapter Tuning",
    category: "PEFT",
    description: "Pairs LoRA rank updates with highly compressed 4-bit NormalFloat parameters to allow massive model adjustments.",
    isUnsupported: (provider) => !["CUDAExecutionProvider", "TensorrtExecutionProvider", "ROCMExecutionProvider"].includes(provider),
    getIncompatibilityReason: () => "Requires GPU CUDA/ROCm acceleration.",
    isActive: (passes) => passes.peft && passes.peftMethod === "qlora",
    toggle: (passes, active) => active ? { ...passes, peftMethod: "lora" } : { ...passes, peft: true, peftMethod: "qlora" },
    requiresExplanation: "QLoRA requires active, high-fidelity dynamic double-quantization backpropagation kernels which are completely unsupported on standard CPU hosts."
  }
];

export function getCellCompatibility(pass: OptimizationPassValidation, provider: IHVProvider) {
  const isUnsupported = pass.isUnsupported(provider);
  
  if (isUnsupported) {
    return {
      status: "unsupported" as const,
      label: "Incompatible",
      color: "bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-[0_0_8px_rgba(239,68,68,0.05)]",
      reason: pass.getIncompatibilityReason(provider),
      speedup: "N/A",
      vram: "N/A",
      efficiency: "0%"
    };
  }

  if (provider === "CPUExecutionProvider") {
    if (pass.id === "peft-adapters" || pass.id === "qlora-adapters") {
      return {
        status: "partial" as const,
        label: "CPU Fallback",
        color: "bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.05)]",
        reason: "Executes correctly but lacks hardware tensor cores. Active tuning is extremely slow on CPUs.",
        speedup: "1.0x (Baseline)",
        vram: "System RAM (-20%)",
        efficiency: "15% (Fallback)"
      };
    }
  }

  // Supported and optimized!
  let speedup = "2.2x";
  let vram = "-50%";
  let efficiency = "95%";
  
  if (pass.id === "openvino-format") {
    speedup = "3.1x";
    vram = "Host Shared";
    efficiency = "98%";
  } else if (pass.id === "awq-quantization") {
    speedup = "2.5x";
    vram = "-72% VRAM";
    efficiency = "92%";
  } else if (pass.id === "qat-quantization") {
    speedup = "1.8x";
    vram = "-50% VRAM";
    efficiency = "88%";
  } else if (pass.id === "structured-sparsity") {
    speedup = "2.0x";
    vram = "No Change";
    efficiency = "99%";
  } else if (pass.id === "peft-adapters") {
    speedup = "1.6x (Tuned)";
    vram = "-60% VRAM";
    efficiency = "94%";
  } else if (pass.id === "qlora-adapters") {
    speedup = "1.5x (Tuned)";
    vram = "-82% VRAM";
    efficiency = "90%";
  }

  return {
    status: "supported" as const,
    label: "Optimized",
    color: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.05)]",
    reason: "Fully supported. Direct edge hardware instruction sets mapped successfully.",
    speedup,
    vram,
    efficiency
  };
}

export function IHVIntegrationPanel({ state, setState }: { state: UIState; setState: (s: Partial<UIState>) => void }) {
  const [passSearch, setPassSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"matrix" | "cards">("matrix");
  const [selectedCategory, setSelectedCategory] = useState<"All" | "Conversion" | "Quantization" | "Compression" | "PEFT">("All");

  const filteredValidations = validations.filter(v => {
    const matchesSearch = v.name.toLowerCase().includes(passSearch.toLowerCase()) || 
                          v.description.toLowerCase().includes(passSearch.toLowerCase()) ||
                          v.category.toLowerCase().includes(passSearch.toLowerCase());
    const matchesCategory = selectedCategory === "All" || v.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Real-time conflicts of the selected hardware provider
  const selectedConflicts = getProviderConflicts(state.ihvProvider, state.passes);
  const hasSelectedCritical = selectedConflicts.some(c => c.severity === "critical");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Card>
        <CardHeader 
          title="Hardware Acceleration (IHV Integration)" 
          description="Select target compute targets. Olive automatically optimizes graphs for these backends."
          badge={<div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/10 text-purple-500"><Settings2 className="h-4 w-4" /></div>}
        />
        <CardContent>
          {/* Hardware Validation Guard Alert Summary Banner */}
          {selectedConflicts.length > 0 && (
            <div className={`mb-6 rounded-xl border p-4.5 animate-in slide-in-from-top-2 duration-300 flex flex-col gap-3.5 ${
              hasSelectedCritical 
                ? "bg-rose-950/15 border-rose-500/30 shadow-[0_2px_12px_rgba(244,63,94,0.03)]" 
                : "bg-amber-955/15 border-amber-500/30 shadow-[0_2px_12px_rgba(245,158,11,0.03)]"
            }`}>
              <div className="flex items-start md:items-center justify-between border-b border-slate-800/80 pb-3 flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-6 w-6 items-center justify-center rounded shrink-0 ${
                    hasSelectedCritical ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-500"
                  }`}>
                    {hasSelectedCritical ? <ShieldAlert className="h-4 w-4 animate-pulse" /> : <AlertTriangle className="h-4 w-4" />}
                  </span>
                  <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider ${hasSelectedCritical ? "text-rose-300" : "text-amber-400"}`}>
                      Hardware Pipeline Conflict Detected ({selectedConflicts.length})
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      The execution passes currently configured in your recipe are incompatible with the selected 
                      <span className="text-white font-semibold"> {providers.find(p => p.id === state.ihvProvider)?.name}</span>.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    let updatedPasses = { ...state.passes };
                    selectedConflicts.forEach(c => {
                      updatedPasses = { ...updatedPasses, ...c.autofix() };
                    });
                    setState({ passes: updatedPasses });
                  }}
                  className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 hover:text-white ${
                    hasSelectedCritical 
                      ? "border-rose-500/30 bg-rose-950/20 text-rose-400 hover:bg-rose-500/20" 
                      : "border-amber-500/30 bg-amber-950/20 text-amber-400 hover:bg-amber-500/20"
                  }`}
                >
                  <Wand2 className="h-3 w-3" /> Auto-Fix Active Config Conflicts
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-4 mt-2">
            {providers.map(p => {
              const isSelected = state.ihvProvider === p.id;
              const Icon = p.icon;
              
              // Compute conflicts for this particular card to implement visual disabled indicators & warnings
              const pConflicts = getProviderConflicts(p.id, state.passes);
              const cardHasCritical = pConflicts.some(c => c.severity === "critical");
              const cardHasWarning = pConflicts.some(c => c.severity === "warning");

              let cardClasses = "relative flex flex-col rounded-xl border p-4.5 transition-all duration-200 cursor-pointer ";
              let badgeText = "";
              let badgeColor = "";

              if (isSelected) {
                if (cardHasCritical) {
                  cardClasses += "border-rose-500 bg-rose-500/5 shadow-[0_0_15px_rgba(244,63,94,0.06)]";
                  badgeText = "Critical Conflict";
                  badgeColor = "bg-rose-500/10 text-rose-400 border-rose-550/25";
                } else if (cardHasWarning) {
                  cardClasses += "border-amber-500 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.06)]";
                  badgeText = "Warning Conflict";
                  badgeColor = "bg-amber-500/10 text-amber-400 border-amber-550/25";
                } else {
                  cardClasses += "border-electric-blue bg-electric-blue/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]";
                  badgeText = "Active Target";
                  badgeColor = "bg-electric-blue/10 text-electric-blue border-electric-blue/20";
                }
              } else {
                if (cardHasCritical) {
                  cardClasses += "border-rose-950/35 bg-zinc-950/40 opacity-55 hover:opacity-100 hover:border-rose-500/40";
                  badgeText = "Incompatible";
                  badgeColor = "bg-rose-500/5 text-rose-400/80 border-rose-550/15";
                } else if (cardHasWarning) {
                  cardClasses += "border-amber-950/35 bg-zinc-950/40 opacity-75 hover:opacity-100 hover:border-amber-500/40";
                  badgeText = "Needs Adjust";
                  badgeColor = "bg-amber-500/5 text-amber-400/80 border-amber-550/15";
                } else {
                  cardClasses += "border-slate-800/80 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700";
                  badgeText = "Compatible";
                  badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/15";
                }
              }

              return (
                <div 
                  key={p.id}
                  onClick={() => {
                    if (pConflicts.length > 0) {
                      // Apply necessary fixes and activate the provider
                      let updatedPasses = { ...state.passes };
                      pConflicts.forEach(c => {
                        updatedPasses = { ...updatedPasses, ...c.autofix() };
                      });
                      setState({ passes: updatedPasses, ihvProvider: p.id });
                    } else {
                      setState({ ihvProvider: p.id });
                    }
                  }}
                  className={cardClasses}
                >
                  <div className="flex items-start gap-4">
                    <div className={`mt-0.5 shrink-0 rounded-xl p-2.5 transition-all ${
                      isSelected 
                        ? cardHasCritical 
                          ? 'bg-rose-500/20 text-rose-400' 
                          : cardHasWarning 
                            ? 'bg-amber-500/20 text-amber-400' 
                            : 'bg-electric-blue/20 text-electric-blue' 
                        : 'bg-slate-850 text-slate-400 group-hover:text-slate-300'
                    }`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-200 text-sm md:text-base leading-none">{p.name}</p>
                        <span className={`text-[9px] font-mono uppercase tracking-wider font-extrabold px-2 py-0.5 rounded border ${badgeColor}`}>
                          {badgeText}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed pr-6">{p.desc}</p>
                    </div>

                    <div className="flex items-center justify-center shrink-0">
                      <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isSelected 
                          ? cardHasCritical 
                            ? 'border-rose-500 text-rose-500' 
                            : cardHasWarning 
                              ? 'border-amber-500 text-amber-500' 
                              : 'border-electric-blue text-electric-blue' 
                          : 'border-slate-700 hover:border-slate-500'
                      }`}>
                        {isSelected && (
                          <div className={`h-2.5 w-2.5 rounded-full ${
                            cardHasCritical ? 'bg-rose-500' : cardHasWarning ? 'bg-amber-500' : 'bg-electric-blue'
                          }`} />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Inline list of critical and warning conflicts within the provider card if any exist */}
                  {pConflicts.length > 0 && (
                    <div className="mt-3.5 pt-3.5 border-t border-slate-800/60 flex flex-col gap-2.5 animate-in fade-in duration-200">
                      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" /> Pipeline Validation Overrides:
                      </p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pb-1">
                        {pConflicts.map((c, idx) => (
                          <div key={idx} className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-900 flex items-start gap-2 text-xs">
                            <span className={`inline-block h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
                              c.severity === "critical" ? "bg-rose-500 animate-pulse" : "bg-amber-400"
                            }`} />
                            <div className="leading-tight">
                              <span className={`font-bold block text-[11px] mb-0.5 ${
                                c.severity === "critical" ? "text-rose-300" : "text-amber-400"
                              }`}>{c.passName}</span>
                              <span className="text-slate-450 text-[10.5px] font-medium leading-relaxed">{c.reason}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Explicit Fix-Me button */}
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            let updatedPasses = { ...state.passes };
                            pConflicts.forEach(c => {
                              updatedPasses = { ...updatedPasses, ...c.autofix() };
                            });
                            setState({ passes: updatedPasses, ihvProvider: p.id });
                          }}
                          className={`text-[9.5px] uppercase tracking-wider font-extrabold px-3 py-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 ${
                            cardHasCritical 
                              ? "border-rose-550/30 text-rose-400 bg-rose-950/20 hover:text-white hover:bg-rose-500/20" 
                              : "border-amber-500/30 text-amber-400 bg-amber-950/20 hover:text-white hover:bg-amber-550/20"
                          }`}
                        >
                          <Wand2 className="h-3.5 w-3.5" /> Resolve and switch to {p.name}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Interactive Optimization Passes Cross-Referencing Matrix */}
          <div className="mt-10 pt-8 border-t border-slate-800">
            {/* Header, Search Filter, and View Toggles */}
            <div className="flex flex-col gap-6 mb-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Activity className="h-4.5 w-4.5 text-purple-400 animate-pulse shrink-0" />
                    Real-Time Hardware Validation & Optimization Matrix
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                    Dynamic grid analyzer maps available compilation passes to driver backends. Select hardware, filter passes, toggle settings directly, or explore simulated silicon performance tooltips.
                  </p>
                </div>
                
                {/* View Switch Segmented Control */}
                <div className="flex items-center bg-slate-950 p-1 border border-slate-800 rounded-lg self-start shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab("matrix")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                      activeTab === "matrix"
                        ? "bg-purple-600 text-white font-bold shadow-md shadow-purple-500/20"
                        : "text-slate-400 hover:text-slate-205"
                    }`}
                  >
                    <Table className="h-3.5 w-3.5" />
                    Matrix View
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("cards")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                      activeTab === "cards"
                        ? "bg-purple-600 text-white font-bold shadow-md shadow-purple-500/20"
                        : "text-slate-400 hover:text-slate-205"
                    }`}
                  >
                    <List className="h-3.5 w-3.5" />
                    Interactive Cards
                  </button>
                </div>
              </div>

              {/* Filtering Suite */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-900/35 p-4 rounded-xl border border-slate-800/60">
                {/* Text Search */}
                <div className="md:col-span-5 relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search compiler passes..."
                    value={passSearch}
                    onChange={(e) => setPassSearch(e.target.value)}
                    className="w-full h-9 bg-slate-950 border border-slate-800/80 rounded-lg pl-9 pr-4 text-xs font-medium text-slate-200 placeholder-slate-500 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all font-sans"
                  />
                  {passSearch && (
                    <button
                      type="button"
                      onClick={() => setPassSearch("")}
                      className="absolute right-2.5 top-2 text-[10px] bg-slate-850 hover:bg-slate-700 text-slate-400 p-1 px-1.5 rounded cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Categories badges filter */}
                <div className="md:col-span-7 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono text-slate-500 uppercase font-black tracking-wider mr-1">Filter:</span>
                  {(["All", "Conversion", "Quantization", "Compression", "PEFT"] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1 rounded-full text-[10.5px] font-semibold tracking-tight transition-all cursor-pointer ${
                        selectedCategory === cat
                          ? "bg-purple-500/15 border-purple-500/40 text-purple-300 font-bold border"
                          : "bg-slate-950 hover:bg-slate-900 border border-slate-805 text-slate-400"
                      }`}
                    >
                      {cat === "All" ? "All Passes" : cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Empty state if search returns nothing */}
            {filteredValidations.length === 0 ? (
              <div className="text-center py-12 rounded-xl border border-dashed border-slate-800/80 bg-slate-900/5 mt-2 animate-in fade-in">
                <ShieldAlert className="h-10 w-10 text-slate-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-350">No optimization passes match your filter criteria</p>
                <p className="text-xs text-slate-505 mt-1 max-w-md mx-auto">Try clearing your search query or choosing "All Passes" to display the full compatibility matrix.</p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setPassSearch("");
                      setSelectedCategory("All");
                    }}
                    className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-bold p-2 px-4 rounded-lg cursor-pointer"
                  >
                    Reset Active Filters
                  </button>
                </div>
              </div>
            ) : activeTab === "matrix" ? (
              /* TAB 1: VALIDATION MATRIX INTERACTIVE HEATMAP */
              <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/25 mt-2 shadow-xl animate-in fade-in duration-300">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="border-b border-slate-800/80 bg-slate-900/30">
                        {/* Header Cell 1 */}
                        <th className="p-4 text-xs font-mono font-semibold tracking-wider text-slate-400 max-w-[280px]">
                          COMPILER OPTIMIZATION PASS
                        </th>
                        
                        {/* 5 Hardware Target Columns */}
                        {providers.map((p) => {
                          const isSelectedProvider = p.id === state.ihvProvider;
                          const HIcon = p.icon;
                          
                          return (
                            <th 
                              key={p.id}
                              onClick={() => {
                                const pConflicts = getProviderConflicts(p.id, state.passes);
                                if (pConflicts.length > 0) {
                                  let updatedPasses = { ...state.passes };
                                  pConflicts.forEach(c => {
                                    updatedPasses = { ...updatedPasses, ...c.autofix() };
                                  });
                                  setState({ passes: updatedPasses, ihvProvider: p.id });
                                } else {
                                  setState({ ihvProvider: p.id });
                                }
                              }}
                              className={`p-4 text-center cursor-pointer transition-all relative select-none ${
                                isSelectedProvider 
                                  ? "bg-purple-500/10 border-l border-r border-t-2 border-t-purple-500 border-l-purple-500/20 border-r-purple-500/20" 
                                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/30"
                              }`}
                            >
                              <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                                <div className={`p-1.5 rounded-lg border leading-none transition-all ${
                                  isSelectedProvider 
                                    ? "bg-purple-950/40 border-purple-500/50 text-purple-300"
                                    : "bg-slate-900 border-slate-800 text-slate-500"
                                }`}>
                                  <HIcon className="h-4 w-4" />
                                </div>
                                <span className={`text-[11px] font-semibold tracking-tight leading-none ${
                                  isSelectedProvider ? "text-purple-300 font-bold" : "text-slate-355"
                                }`}>
                                  {p.name.replace(" (Snapdragon)", "")}
                                </span>
                                {isSelectedProvider ? (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <span className="flex h-1.5 w-1.5 relative">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                    </span>
                                    <span className="text-[9px] tracking-widest font-mono font-black uppercase text-purple-400 leading-none">
                                      Active
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[8.5px] font-mono text-slate-600 uppercase tracking-wider leading-none select-none hover:text-slate-400 mt-0.5">
                                    Select
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    
                    <tbody>
                      {filteredValidations.map((v) => {
                        const isActiveOnSelected = v.isActive(state.passes);
                        
                        return (
                          <tr key={v.id} className="border-b border-slate-900 hover:bg-slate-900/10 transition-colors">
                            {/* Column 1: Row Title and Category info */}
                            <td className="p-4 max-w-[280px]">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[8.5px] font-mono uppercase px-1.5 py-0.5 rounded border leading-none shrink-0 font-extrabold ${
                                    v.category === "Conversion"
                                      ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                      : v.category === "Quantization"
                                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                        : v.category === "Compression"
                                          ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  }`}>
                                    {v.category}
                                  </span>
                                  
                                  <span className="text-xs font-bold text-slate-200 leading-tight">
                                    {v.name}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-450 leading-relaxed font-sans pr-4 line-clamp-2" title={v.description}>
                                  {v.description}
                                </p>
                              </div>
                            </td>

                            {/* Column 2-6: Dynamic hardware cells */}
                            {providers.map((p) => {
                              const isSelectedProvider = p.id === state.ihvProvider;
                              const comp = getCellCompatibility(v, p.id);
                              const isCurrentlyActiveInCore = isSelectedProvider && isActiveOnSelected;

                              const handleCellClick = () => {
                                if (comp.status === "unsupported") return;
                                
                                if (isSelectedProvider) {
                                  // Toggle the pass on the active provider
                                  const updated = v.toggle(state.passes, isActiveOnSelected);
                                  setState({ passes: { ...state.passes, ...updated } });
                                } else {
                                  // Switch hardware provider, resolving any incompatibilities, and toggling this pass on if appropriate
                                  const pConflicts = getProviderConflicts(p.id, state.passes);
                                  let updatedPasses = { ...state.passes };
                                  pConflicts.forEach(c => {
                                    updatedPasses = { ...updatedPasses, ...c.autofix() };
                                  });
                                  // Now set the target pass as well if it's compatible
                                  const finalPasses = { ...updatedPasses, ...v.toggle(updatedPasses, false) };
                                  setState({ passes: finalPasses, ihvProvider: p.id });
                                }
                              };

                              return (
                                <td 
                                  key={p.id}
                                  onClick={handleCellClick}
                                  className={`p-4 text-center transition-all ${
                                    isSelectedProvider 
                                      ? "bg-purple-500/5 border-l border-r border-purple-500/10" 
                                      : "hover:bg-slate-900/30"
                                  } ${comp.status === "unsupported" ? "cursor-not-allowed" : "cursor-pointer"}`}
                                >
                                  <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="inline-flex items-center justify-center p-1 cursor-help">
                                          {comp.status === "supported" ? (
                                            isCurrentlyActiveInCore ? (
                                              <div className="flex h-6 items-center gap-1 p-1 px-3 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10.5px] font-mono font-bold hover:scale-105 active:scale-95 transition-all shadow-[0_0_12px_rgba(16,185,129,0.15)]">
                                                <CheckCircle className="h-3.5 w-3.5 animate-pulse text-emerald-400" /> Active
                                              </div>
                                            ) : (
                                              <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 hover:border-emerald-500/40 hover:bg-emerald-500/10 flex items-center justify-center text-slate-500 hover:text-emerald-400 hover:scale-110 active:scale-90 transition-all">
                                                <Check className="h-3.5 w-3.5" />
                                              </div>
                                            )
                                          ) : comp.status === "partial" ? (
                                            isCurrentlyActiveInCore ? (
                                              <div className="flex h-6 items-center gap-1 p-1 px-3 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-550 text-[10.5px] font-mono font-bold hover:scale-105 active:scale-95 transition-all shadow-[0_0_12px_rgba(245,158,11,0.12)]">
                                                <AlertCircle className="h-3.5 w-3.5 animate-pulse text-amber-400" /> Fallback
                                              </div>
                                            ) : (
                                              <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 hover:border-amber-500/40 hover:bg-amber-500/10 flex items-center justify-center text-slate-500 hover:text-amber-400 hover:scale-110 active:scale-90 transition-all">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                              </div>
                                            )
                                          ) : (
                                            <div className="h-6 w-6 rounded-full bg-slate-950 border border-slate-900/60 flex items-center justify-center text-slate-700/60">
                                              <Lock className="h-3 w-3" />
                                            </div>
                                          )}
                                        </div>
                                      </TooltipTrigger>
                                      
                                      <TooltipContent side="top" className="max-w-[325px] bg-slate-950 border border-slate-800 text-slate-300 p-4 shadow-2xl leading-relaxed z-50">
                                        <div className="space-y-3">
                                          <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                                            <span className="text-[9.5px] font-mono uppercase bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-800">
                                              {p.name.replace(" (Snapdragon)", "")}
                                            </span>
                                            <span className={`text-[9.5px] font-mono font-extrabold uppercase tracking-wider px-2 py-0.5 rounded leading-none ${
                                              comp.status === "supported" 
                                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                                : comp.status === "partial" 
                                                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
                                                  : "bg-rose-500/10 text-rose-450 border border-rose-500/20"
                                            }`}>
                                              {comp.label}
                                            </span>
                                          </div>

                                          <div className="space-y-1">
                                            <p className="text-[11.5px] font-mono font-bold text-purple-300 uppercase tracking-wide">
                                              {v.name}
                                            </p>
                                            <p className="text-slate-400 text-xs leading-relaxed">{comp.reason}</p>
                                          </div>

                                          {/* Direct Silicon Acceleration Hardware Registers */}
                                          <div className="grid grid-cols-3 gap-1.5 border-t border-slate-900 pt-3">
                                            <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                              <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">Pass Speed</span>
                                              <span className={`text-xs font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-350"}`}>{comp.speedup}</span>
                                            </div>
                                            <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                              <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">VRAM impact</span>
                                              <span className={`text-xs font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-350"}`}>{comp.vram}</span>
                                            </div>
                                            <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                              <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">Silicon Core</span>
                                              <span className={`text-xs font-black block ${comp.status === "supported" ? "text-purple-400" : "text-slate-350"}`}>{comp.efficiency}</span>
                                            </div>
                                          </div>

                                          <div className="text-[10px] text-slate-500 font-sans border-t border-slate-900 pt-2.5 leading-snug">
                                            {comp.status === "unsupported" 
                                              ? `${v.name} is completely incompatible with the target instruction architecture.`
                                              : isSelectedProvider
                                                ? `Click this column cell directly to toggle the ${v.name} pass ${isCurrentlyActiveInCore ? 'OFF' : 'ON'}.`
                                                : `Click to set acceleration to ${p.name} and configure this pipeline pass.`}
                                          </div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Matrix Footer Legend */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t border-slate-900 bg-slate-900/20 text-[11px] text-slate-400">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="font-mono text-slate-500 uppercase tracking-widest font-black text-[10px]">LEGEND:</span>
                    <span className="flex items-center gap-1.5 font-sans">
                      <span className="h-3.5 w-3.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400"><Check className="h-2 w-2" /></span>
                      Optimized Acceleration Available
                    </span>
                    <span className="flex items-center gap-1.5 font-sans">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      CPU Fallback Emulation Modality
                    </span>
                    <span className="flex items-center gap-1.5 font-sans">
                      <Lock className="h-3 w-3 text-slate-500" />
                      Incompatible / Blocked on Chipset
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10.5px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/15 p-1 px-2.5 rounded">
                    <Sparkles className="h-3 w-3 animate-spin duration-3000 shrink-0 text-purple-350 animate-pulse" /> Live validation engine connected
                  </div>
                </div>
              </div>
            ) : (
              /* TAB 2: DETAILED INTERACTIVE SHOWN CARDS */
              <TooltipProvider delayDuration={150}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 animate-in fade-in">
                  {filteredValidations.map((v) => {
                    const isUnsupportedOnCurrent = v.isUnsupported(state.ihvProvider);
                    const isActiveState = v.isActive(state.passes);
                    const reason = v.getIncompatibilityReason(state.ihvProvider);
                    
                    return (
                      <div
                        key={v.id}
                        className={`flex flex-col justify-between p-4.5 rounded-xl border transition-all relative overflow-hidden ${
                          isUnsupportedOnCurrent
                            ? "bg-slate-950/40 border-slate-900/60 opacity-40 shadow-none hover:border-slate-800/40"
                            : isActiveState
                              ? "bg-electric-blue/5 border-electric-blue/40 shadow-[0_2px_12px_rgba(59,130,246,0.02)] hover:border-electric-blue/60"
                              : "bg-slate-900/30 border-slate-800/80 hover:bg-slate-900/65 hover:border-slate-700"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-1.5">
                            <div>
                              <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded border tracking-wider font-extrabold ${
                                v.category === "Conversion"
                                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                  : v.category === "Quantization"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : v.category === "Compression"
                                      ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              }`}>
                                {v.category}
                              </span>
                              <h5 className={`text-xs font-bold mt-2 flex items-center gap-1.5 leading-tight ${
                                isUnsupportedOnCurrent ? "text-slate-500" : "text-slate-200"
                              }`}>
                                {v.name}
                              </h5>
                            </div>

                            {isUnsupportedOnCurrent ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="cursor-help shrink-0 p-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 leading-none">
                                    <Lock className="h-3 w-3" /> Incompatible
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[280px] bg-slate-950 border border-slate-800 text-slate-300 p-3 shadow-xl leading-relaxed">
                                  <div className="space-y-1">
                                    <p className="font-bold text-rose-400 flex items-center gap-1 text-xs">
                                      <AlertCircle className="h-3.5 w-3.5" /> Hardware Incompatibility
                                    </p>
                                    <p className="text-slate-200 font-semibold">{reason}</p>
                                    <p className="text-slate-450 border-t border-slate-900 pt-1 mt-1 text-[11px] font-sans leading-normal">{v.requiresExplanation}</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border flex items-center gap-1 leading-none shrink-0 ${
                                isActiveState
                                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                  : "bg-slate-850/40 border-slate-800 text-slate-500"
                              }`}>
                                {isActiveState ? (
                                  <>
                                    <CheckCircle className="h-3 w-3 animate-pulse" /> Enabled
                                  </>
                                ) : (
                                  "Inactive"
                                )}
                              </span>
                            )}
                          </div>

                          <p className={`text-slate-400 text-xs leading-relaxed ${isUnsupportedOnCurrent ? "text-slate-600" : ""}`}>
                            {v.description}
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-900/60 flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-500 font-medium">
                            {isUnsupportedOnCurrent ? "Pass locked on current backend" : `Direct toggle on ${providers.find(p => p.id === state.ihvProvider)?.name}`}
                          </span>
                          <Switch
                            disabled={isUnsupportedOnCurrent}
                            checked={isUnsupportedOnCurrent ? false : isActiveState}
                            onCheckedChange={(checked) => {
                              if (isUnsupportedOnCurrent) return;
                              const updated = v.toggle(state.passes, isActiveState);
                              setState({ passes: { ...state.passes, ...updated } });
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TooltipProvider>
            )}
          </div>
          
          {/* Vendor Specific Flags - Show dynamically based on selection */}
          <div className="mt-8 pt-6 border-t border-slate-800">
            <h4 className="text-sm font-medium mb-4 text-slate-300 flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Target Specific Flags
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {state.ihvProvider === "TensorrtExecutionProvider" || state.ihvProvider === "CUDAExecutionProvider" ? (
                <>
                  <div className="flex items-center justify-between">
                    <div><Label>Use fp16</Label><p className="text-xs text-slate-500">Enable Tensor Core math.</p></div>
                    <Switch defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <div><Label>Enable TensorRT Graph Optimizations</Label><p className="text-xs text-slate-500">Build TensorRT engines dynamically.</p></div>
                    <Switch defaultChecked />
                  </div>
                </>
              ) : state.ihvProvider === "OpenVINOExecutionProvider" ? (
                <>
                   <div className="flex items-center justify-between">
                    <div><Label>Target Device</Label><p className="text-xs text-slate-500">CPU, GPU, NPU</p></div>
                    <Select className="w-full max-w-[150px]">
                      <option>NPU</option>
                      <option>CPU</option>
                      <option>GPU</option>
                    </Select>
                  </div>
                </>
              ) : (
                <div className="col-span-2 text-sm text-slate-500 py-2">
                  No advanced configuration required for the standard execution provider.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
