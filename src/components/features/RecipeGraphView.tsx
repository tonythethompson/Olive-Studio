import { useState, useLayoutEffect, useEffect, useRef, type ReactElement } from "react";
import { UIState } from "@/types";
import { Button, Card, CardContent, Input, Label, Slider, Select } from "@/components/ui";
import {
  applyIssueAutofix,
  getAllowedConversionFormats,
  getAllowedPeftMethods,
  getAllowedPruningTypes,
  getAllowedQuantMethods,
  getPipelineValidation,
  getRemainingAdvisories,
} from "@/lib/pipelineValidation";
import { 
  Database, 
  Workflow, 
  Minimize2, 
  Layers, 
  Cpu, 
  Package, 
  Sparkles, 
  Cpu as TargetIcon, 
  ChevronRight, 
  Plus, 
  X, 
  Check, 
  Info, 
  Settings, 
  Activity,
  AlertTriangle,
  ArrowUpRight
} from "lucide-react";

interface RecipeGraphViewProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  showDot?: boolean;
}

type GraphPoint = { x: number; y: number };

function buildSegmentCurve(from: GraphPoint, to: GraphPoint): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const c1x = from.x + dx * 0.45;
    const c2x = from.x + dx * 0.55;
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
  }

  const c1y = from.y + dy * 0.45;
  const c2y = from.y + dy * 0.55;
  return `M ${from.x} ${from.y} C ${from.x} ${c1y}, ${to.x} ${c2y}, ${to.x} ${to.y}`;
}

function appendSegmentCurve(from: GraphPoint, to: GraphPoint): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const c1x = from.x + dx * 0.45;
    const c2x = from.x + dx * 0.55;
    return `C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
  }

  const c1y = from.y + dy * 0.45;
  const c2y = from.y + dy * 0.55;
  return `C ${from.x} ${c1y}, ${to.x} ${c2y}, ${to.x} ${to.y}`;
}

// Derive allowable conversionInputTargetTypes from the selected model identifier
function getModelDefaultInputType(state: UIState): string {
  const id = (
    state.modelSource === "huggingface" ? state.hfModelId :
    state.modelSource === "azure" ? state.azureModelPath :
    state.localFiles?.[0]?.name ?? ""
  ).toLowerCase();

  if (id.includes("whisper")) return "float16";
  if (id.includes("diffusion") || id.includes("unet") || id.includes("sdxl") || id.includes("flux")) return "float16";
  if (id.includes("bert") || id.includes("roberta") || id.includes("t5")) return "float32";
  // LLMs and generic default
  return "float16";
}

export function RecipeGraphView({ state, setState, showDot = true }: RecipeGraphViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("input");
  const [connections, setConnections] = useState<{ from: string; to: string }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  // Keep conversionInputTargetTypes in sync with the selected model family
  useEffect(() => {
    const defaultType = getModelDefaultInputType(state);
    const allowed = ["float16", "bfloat16", "float32", "int8", "int32", "int64"];
    if (!allowed.includes(state.passes.conversionInputTargetTypes)) {
      setState({ passes: { ...state.passes, conversionInputTargetTypes: defaultType } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.modelSource, state.hfModelId, state.azureModelPath, state.localFiles.length]);

  // Redraw connections when layout or pipeline changes
  useLayoutEffect(() => {
    const handleResize = () => setLayoutTick((prev) => prev + 1);
    window.addEventListener("resize", handleResize);

    const r = requestAnimationFrame(() => setLayoutTick((prev) => prev + 1));

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(r);
    };
  }, [
    state.passes.conversion,
    state.passes.quantization,
    state.passes.pruning,
    state.passes.onnxTransforms,
    state.passes.splitting,
    state.passes.peft,
    state.modelSource,
    state.hfModelId,
    state.ihvProvider,
    selectedNodeId,
  ]);

  // Define active pipeline flow
  const pipelineSteps = [
    { id: "input", label: "Model Input", active: true },
    { id: "splitting", label: "Split Model", active: state.passes.splitting },
    { id: "peft", label: "PEFT / LoRA", active: state.passes.peft },
    { id: "conversion", label: "Conversion", active: state.passes.conversion },
    { id: "pruning", label: "Pruning", active: state.passes.pruning },
    { id: "transformer_opt", label: "ORT Transform", active: state.passes.onnxTransforms },
    { id: "quantization", label: "Quantization", active: state.passes.quantization },
    { id: "provider", label: "Target IHV", active: true },
    { id: "output", label: "Optimized Output", active: true }
  ];

  const getConnectionPoints = (fromId: string, toId: string): { from: GraphPoint; to: GraphPoint } | null => {
    if (!containerRef.current) return null;

    const fromElem = document.getElementById(`node-btn-${fromId}`);
    const toElem = document.getElementById(`node-btn-${toId}`);
    if (!fromElem || !toElem) return null;

    const parentRect = containerRef.current.getBoundingClientRect();
    const toParent = (rect: DOMRect) => ({
      left: rect.left - parentRect.left,
      top: rect.top - parentRect.top,
      right: rect.right - parentRect.left,
      bottom: rect.bottom - parentRect.top,
      cx: rect.left - parentRect.left + rect.width / 2,
      cy: rect.top - parentRect.top + rect.height / 2,
    });

    const fromBox = toParent(fromElem.getBoundingClientRect());
    const toBox = toParent(toElem.getBoundingClientRect());

    const dx = toBox.cx - fromBox.cx;
    const dy = toBox.cy - fromBox.cy;

    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0
        ? { from: { x: fromBox.right, y: fromBox.cy }, to: { x: toBox.left, y: toBox.cy } }
        : { from: { x: fromBox.left, y: fromBox.cy }, to: { x: toBox.right, y: toBox.cy } };
    }

    return dy >= 0
      ? { from: { x: fromBox.cx, y: fromBox.bottom }, to: { x: toBox.cx, y: toBox.top } }
      : { from: { x: fromBox.cx, y: fromBox.top }, to: { x: toBox.cx, y: toBox.bottom } };
  };

  const activeNodes = pipelineSteps.filter((s) => s.active);
  void layoutTick;

  const validation = getPipelineValidation(state);
  const advisories = getRemainingAdvisories(state);
  const allowedQuantMethods = getAllowedQuantMethods(state.ihvProvider);
  const allowedConversionFormats = getAllowedConversionFormats(state.ihvProvider);
  const allowedPruningTypes = getAllowedPruningTypes(state.ihvProvider);
  const allowedPeftMethods = getAllowedPeftMethods(state.ihvProvider);

  // Per-node worst-severity conflict level for graph badge rendering
  const nodeIssueLevel = (nodeId: string): "critical" | "warning" | null => {
    const relevant = validation.issues.filter(i => i.affectedPasses?.includes(nodeId));
    if (relevant.some(i => i.severity === "critical")) return "critical";
    if (relevant.some(i => i.severity === "warning")) return "warning";
    return null;
  };

  // Render SVG wires Dynamically
  const renderSVGConnections = () => {
    if (!containerRef.current) return null;

    const paths: ReactElement[] = [];
    const parentRect = containerRef.current.getBoundingClientRect();
    // Bypass lane: 28px from top of container, 8px below bottom
    const arcYTop = 28;

    const numSegs = activeNodes.length - 1;
    const totalDur = Math.max(2, numSegs * 0.8);

    for (let i = 0; i < numSegs; i++) {
      const fromNode = activeNodes[i];
      const toNode = activeNodes[i + 1];
      const fromPipelineIdx = pipelineSteps.findIndex(s => s.id === fromNode.id);
      const toPipelineIdx = pipelineSteps.findIndex(s => s.id === toNode.id);

      // Are there any inactive steps between these two active nodes?
      const hasSkip = pipelineSteps
        .slice(fromPipelineIdx + 1, toPipelineIdx)
        .some(s => !s.active);

      const tStart = i / numSegs;
      const tEnd = (i + 1) / numSegs;
      const tStartBefore = Math.max(0, tStart - 0.001);
      const tEndAfter = Math.min(1, tEnd + 0.001);

      let d: string;

      if (hasSkip) {
        // Route over/under the skipped nodes via a bypass lane
        const fromElem = document.getElementById(`node-btn-${fromNode.id}`);
        const toElem = document.getElementById(`node-btn-${toNode.id}`);
        if (!fromElem || !toElem) continue;

        const fromR = fromElem.getBoundingClientRect();
        const toR = toElem.getBoundingClientRect();
        const fromX = fromR.left - parentRect.left + fromR.width / 2;
        const fromY = fromR.top - parentRect.top;
        const toX = toR.left - parentRect.left + toR.width / 2;
        const toY = toR.top - parentRect.top;

        const arcY = arcYTop;

        d = `M ${fromX} ${fromY} C ${fromX} ${arcY}, ${toX} ${arcY}, ${toX} ${toY}`;

        // Subtle bypass lane track
        paths.push(
          <path
            key={`bypass-lane-${fromNode.id}-${toNode.id}`}
            d={d}
            fill="none"
            stroke="rgba(100, 116, 139, 0.08)"
            strokeWidth="8"
            className="transition-all duration-300"
          />
        );
      } else {
        const points = getConnectionPoints(fromNode.id, toNode.id);
        if (!points) continue;
        d = buildSegmentCurve(points.from, points.to);
      }

      paths.push(
        <g key={`${fromNode.id}-${toNode.id}`}>
          <path
            d={d}
            fill="none"
            stroke={hasSkip ? "rgba(141, 168, 64, 0.08)" : "rgba(141, 168, 64, 0.12)"}
            strokeWidth={hasSkip ? 5 : 6}
            className="transition-all duration-300"
          />
          <path
            d={d}
            fill="none"
            stroke="url(#wireGradient)"
            strokeWidth={hasSkip ? 1.5 : 2}
            strokeDasharray="6 6"
            strokeOpacity={hasSkip ? 0.6 : 1}
            className="transition-all duration-300"
          >
            <animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.7s" repeatCount="indefinite" />
          </path>
          {showDot && (
            <circle r={hasSkip ? 3 : 3.5} fill="#8DA840" opacity="0">
              <animateMotion
                dur={`${totalDur}s`}
                repeatCount="indefinite"
                path={d}
                calcMode="linear"
                keyPoints="0;0;1;1"
                keyTimes={`0;${tStart};${tEnd};1`}
              />
              <animate
                attributeName="opacity"
                dur={`${totalDur}s`}
                repeatCount="indefinite"
                values="0;0;1;1;0;0"
                keyTimes={`0;${tStartBefore};${tStart};${tEnd};${tEndAfter};1`}
              />
            </circle>
          )}
        </g>
      );
    }

    return (
      <svg className="absolute inset-0 pointer-events-none w-full h-full z-0 overflow-visible">
        <defs>
          <linearGradient id="wireGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#8DA840" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        {paths}
      </svg>
    );
  };

  // Select Node Handler
  const handleNodeClick = (id: string) => {
    setSelectedNodeId(id);
  };

  // Core model weights calculation details
  const getSelectedModelName = () => {
    if (state.modelSource === "huggingface") {
      return state.hfModelId ? state.hfModelId.split("/").pop() : "Llama-3-8B";
    } else if (state.modelSource === "azure") {
      return state.azureModelPath ? state.azureModelPath.split("/").pop() : "Asset Container";
    } else {
      return state.localFiles.length > 0 ? state.localFiles[0].name : "unet_weights.pt";
    }
  };

  // Node Content Visualizers helper
  const getNodePreviewData = (nodeId: string) => {
    switch (nodeId) {
      case "input":
        return {
          title: "Base Model Input",
          desc: getSelectedModelName(),
          icon: <Database className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
          colorTheme: "border-electric-blue/30 text-electric-blue bg-electric-blue/5",
          badge: state.modelSource === "huggingface" ? "Hugging Face" : state.modelSource === "azure" ? "AzureML" : "Local Folder"
        };
      case "splitting":
        return {
          title: "Model Splitting",
          desc: state.passes.splitting ? "Multi-GPU Partitioning" : "Bypassed Baseline",
          icon: <Workflow className="h-5 w-5 text-amber-500 group-hover:text-amber-400" />,
          colorTheme: state.passes.splitting ? "border-amber-500/30 text-amber-500 bg-amber-500/5" : "border-slate-800 text-slate-500",
          badge: state.passes.splitting ? "Active" : "Skipped"
        };
      case "peft":
        return {
          title: "PEFT / LoRA Tuning",
          desc: state.passes.peft ? `${state.passes.peftMethod.toUpperCase()} Adapters` : "Bypassed Baseline",
          icon: <Layers className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
          colorTheme: state.passes.peft ? "border-electric-blue/30 text-electric-blue bg-electric-blue/5" : "border-slate-800 text-slate-500",
          badge: state.passes.peft ? "Active" : "Skipped"
        };
      case "conversion":
        return {
          title: "Graph Conversion",
          desc: state.passes.conversion ? (state.passes.conversionFormat === "onnx" ? `ONNX Opset ${state.passes.conversionOpset}` : "OpenVINO Engine") : "Bypassed Baseline",
          icon: <Workflow className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
          colorTheme: state.passes.conversion ? "border-electric-blue/30 text-electric-blue bg-electric-blue/5" : "border-slate-800 text-slate-500",
          badge: state.passes.conversion ? "Active.onnx" : "Skipped"
        };
      case "pruning":
        return {
          title: "Sparsity Pruning",
          desc: state.passes.pruning ? `${(state.passes.pruningSparsity * 100).toFixed(0)}% (${state.passes.pruningMethod})` : "Bypassed Baseline",
          icon: <Minimize2 className="h-5 w-5 text-amber-500 group-hover:text-amber-400" />,
          colorTheme: state.passes.pruning ? "border-amber-500/30 text-amber-500 bg-amber-500/5" : "border-slate-800 text-slate-500",
          badge: state.passes.pruning ? "Active" : "Skipped"
        };
      case "transformer_opt":
        return {
          title: "ORT Optimizations",
          desc: state.passes.onnxTransforms ? "Fusion & Fused Kernels" : "Bypassed Baseline",
          icon: <Layers className="h-5 w-5 text-slate-400 group-hover:text-slate-300" />,
          colorTheme: state.passes.onnxTransforms ? "border-slate-600/50 text-slate-300 bg-slate-800/40" : "border-slate-800 text-slate-500",
          badge: state.passes.onnxTransforms ? "Active" : "Skipped"
        };
      case "quantization":
        return {
          title: "Quantization Target",
          desc: state.passes.quantization ? `${state.passes.quantPrecision} (${state.passes.quantMethod.toUpperCase()})` : "Bypassed Baseline",
          icon: <Sparkles className="h-5 w-5 text-emerald-400 group-hover:text-emerald-300" />,
          colorTheme: state.passes.quantization ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5" : "border-slate-800 text-slate-500",
          badge: state.passes.quantization ? "Active" : "Skipped"
        };
      case "provider":
        return {
          title: "IHV Target Device",
          desc: state.ihvProvider.replace("ExecutionProvider", ""),
          icon: <Cpu className="h-5 w-5 text-electric-blue group-hover:text-electric-blue/80" />,
          colorTheme: "border-electric-blue/30 text-electric-blue bg-electric-blue/5",
          badge: "Execution Hardware"
        };
      case "output":
      default:
        let sizeText = "4.2x Comp.";
        if (state.passes.quantization && state.passes.quantPrecision === "int4") sizeText = "7.8x Comp.";
        if (!state.passes.quantization && !state.passes.pruning) sizeText = "Original Ratio";
        return {
          title: "Deployment Artifact",
          desc: `Ready: .zip Package`,
          icon: <Package className="h-5 w-5 text-emerald-400 group-hover:text-emerald-300" />,
          colorTheme: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5",
          badge: sizeText
        };
    }
  };

  // Node Toggler Handler (Enable/Disable togglable passes directly from the graph inspector)
  const togglePassState = (nodeId: string) => {
    const updatedPasses = { ...state.passes };
    if (nodeId === "conversion") {
      updatedPasses.conversion = !updatedPasses.conversion;
    } else if (nodeId === "pruning") {
      updatedPasses.pruning = !updatedPasses.pruning;
    } else if (nodeId === "transformer_opt") {
      updatedPasses.onnxTransforms = !updatedPasses.onnxTransforms;
    } else if (nodeId === "quantization") {
      updatedPasses.quantization = !updatedPasses.quantization;
    } else if (nodeId === "splitting") {
      updatedPasses.splitting = !updatedPasses.splitting;
    } else if (nodeId === "peft") {
      updatedPasses.peft = !updatedPasses.peft;
    }
    setState({ passes: updatedPasses });
  };

  return (
    <div className="flex flex-col h-full overflow-x-auto">

      {/* Node Stage Grid Workspace Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-[420px] bg-slate-950 p-4 md:p-6 flex flex-col justify-center select-none overflow-visible"
        style={{
          backgroundImage: `
            radial-gradient(ellipse at center, rgba(30, 41, 59, 0.4) 0%, transparent 80%),
            radial-gradient(circle, rgba(15, 23, 42, 0.8) 1px, transparent 1px)
          `,
          backgroundSize: "24px 24px",
        }}
      >
        {/* Dynamic Glowing lines linking nodes */}
        {renderSVGConnections()}

        {/* 3 Main Tiers horizontally arranged */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-y-6 md:gap-3 relative z-10 items-center justify-between h-full w-full min-w-0 md:min-w-[720px]">
          
          {/* Column 1: Model Source Input Model (Cols 1-3) */}
          <div className="md:col-span-2 flex flex-col justify-center items-center h-full">
            <div className="text-xs text-slate-500 mb-3">
              Input
            </div>
            {(() => {
              const nd = getNodePreviewData("input");
              const isSelected = selectedNodeId === "input";
              return (
                <button
                  id="node-btn-input"
                  onClick={() => handleNodeClick("input")}
                  className={`group w-full max-w-[240px] text-left p-4 rounded-xl border transition-all duration-300 relative ${
                    isSelected 
                    ? "border-electric-blue bg-electric-blue/10 ring-1 ring-electric-blue" 
                    : "border-slate-800 hover:border-slate-700 bg-slate-900/60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="p-1.5 rounded bg-electric-blue/10 border border-electric-blue/20 group-hover:bg-electric-blue/15 transition-all duration-200">
                      {nd.icon}
                    </div>
                    <span className="text-[9px] px-2 py-0.5 bg-slate-900 border border-electric-blue/20 text-electric-blue rounded font-mono">
                      {nd.badge}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold text-slate-100 mb-1 leading-tight">{nd.title}</h4>
                  <p className="text-[11px] font-mono text-slate-400 truncate leading-relaxed">{nd.desc}</p>
                </button>
              );
            })()}
          </div>

          {/* Column 2: Olive Optimization Steps Carousel Cascades (Cols 4-8) */}
          <div className="md:col-span-7 flex flex-col items-center justify-center gap-4 border-l border-r border-slate-900/30 px-4">
            <div className="text-xs text-slate-500 mb-1">
              Optimization passes
            </div>
            
            <div className="grid grid-cols-3 gap-4 w-full">
              {["splitting", "peft", "conversion", "pruning", "transformer_opt", "quantization"].map(id => {
                const nd = getNodePreviewData(id);
                const isSelected = selectedNodeId === id;
                const active = pipelineSteps.find(s => s.id === id)?.active;
                const issueLevel = active ? nodeIssueLevel(id) : null;

                return (
                  <button
                    key={id}
                    id={`node-btn-${id}`}
                    onClick={() => handleNodeClick(id)}
                    className={`group text-left p-2 rounded-lg border transition-all duration-300 relative flex flex-col justify-between ${
                      isSelected
                        ? issueLevel === "critical"
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500"
                          : issueLevel === "warning"
                            ? "border-amber-500 bg-amber-950/10 ring-1 ring-amber-500"
                            : "border-electric-blue bg-electric-blue/10 ring-1 ring-electric-blue"
                        : issueLevel === "critical"
                          ? "border-rose-700/60 bg-rose-950/10 hover:border-rose-600"
                          : issueLevel === "warning"
                            ? "border-amber-700/50 bg-amber-950/5 hover:border-amber-600"
                            : active
                              ? "border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/60"
                              : "border-slate-900/50 hover:border-slate-800/80 bg-slate-950/60 opacity-60 hover:opacity-85 border-dashed"
                    }`}
                  >
                    {issueLevel && (
                      <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${issueLevel === "critical" ? "bg-rose-500" : "bg-amber-400"}`} />
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className={`p-1 rounded ${
                          issueLevel === "critical" ? "bg-rose-950/40 border border-rose-700/40 text-rose-400"
                          : issueLevel === "warning" ? "bg-amber-950/30 border border-amber-700/30 text-amber-400"
                          : active ? "bg-electric-blue/10 border border-electric-blue/20 text-electric-blue"
                          : "bg-slate-950 border border-slate-900 text-slate-500"
                        }`}>
                          {nd.icon}
                        </div>
                        <span className={`text-[8px] font-mono px-1 py-0.2 rounded border uppercase whitespace-nowrap ${
                          issueLevel === "critical" ? "bg-rose-950/40 text-rose-400 border-rose-700/40"
                          : issueLevel === "warning" ? "bg-amber-950/30 text-amber-400 border-amber-700/30"
                          : active ? "bg-slate-950 text-electric-blue border-electric-blue/20"
                          : "bg-slate-950 text-slate-600 border-slate-900"
                        }`}>
                          {issueLevel === "critical" ? "Conflict" : issueLevel === "warning" ? "Warning" : active ? "Active" : "Skip"}
                        </span>
                      </div>
                      <h4 className="text-[11px] font-bold text-slate-200 truncate leading-snug">{nd.title}</h4>
                      <p className="text-[10px] text-slate-400 leading-tight font-mono line-clamp-2 mt-1 min-h-[20px]">{nd.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Column 3: Accelerator Target and Optimized Outputs (Cols 9-12) */}
          <div className="md:col-span-3 flex flex-col items-center justify-center gap-6 h-full">
            
            {/* Accelerator Host Node */}
            <div className="w-full flex flex-col items-center">
              <div className="text-xs text-slate-500 mb-2.5">
                Target device
              </div>
              {(() => {
                const nd = getNodePreviewData("provider");
                const isSelected = selectedNodeId === "provider";
                const providerIssue = nodeIssueLevel("provider");
                return (
                  <button
                    id="node-btn-provider"
                    onClick={() => handleNodeClick("provider")}
                    className={`group w-full max-w-[240px] text-left p-3.5 rounded-xl border transition-all duration-300 relative ${
                      isSelected
                        ? providerIssue === "critical"
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500"
                          : providerIssue === "warning"
                            ? "border-amber-500 bg-amber-950/10 ring-1 ring-amber-500"
                            : "border-electric-blue bg-electric-blue/10 ring-1 ring-electric-blue"
                        : providerIssue === "critical"
                          ? "border-rose-700/60 bg-rose-950/10 hover:border-rose-600"
                          : providerIssue === "warning"
                            ? "border-amber-700/50 bg-amber-950/5 hover:border-amber-600"
                            : "border-slate-800 hover:border-slate-700 bg-slate-900/60"
                    }`}
                  >
                    {providerIssue && (
                      <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${providerIssue === "critical" ? "bg-rose-500" : "bg-amber-400"}`} />
                    )}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className={`p-1.5 rounded border transition-all duration-200 ${
                        providerIssue === "critical" ? "bg-rose-950/40 border-rose-700/40 text-rose-400"
                        : providerIssue === "warning" ? "bg-amber-950/30 border-amber-700/30 text-amber-400"
                        : "bg-electric-blue/10 border-electric-blue/20 group-hover:bg-electric-blue/15"
                      }`}>
                        {nd.icon}
                      </div>
                    </div>
                    <h4 className="text-[11px] font-semibold text-slate-100">{nd.title}</h4>
                    <p className="text-[10px] font-mono text-slate-400 leading-snug truncate">{nd.desc}</p>
                  </button>
                );
              })()}
            </div>

            {/* Output Node */}
            <div className="w-full flex flex-col items-center">
              <div className="text-xs text-slate-500 mb-2.5">
                Output
              </div>
              {(() => {
                const nd = getNodePreviewData("output");
                const isSelected = selectedNodeId === "output";
                return (
                  <button
                    id="node-btn-output"
                    onClick={() => handleNodeClick("output")}
                    className={`group w-full max-w-[240px] text-left p-3.5 rounded-xl border transition-all duration-300 relative ${
                      isSelected 
                      ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500" 
                      : "border-slate-800 hover:border-slate-700 bg-slate-900/60"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-all duration-200">
                        {nd.icon}
                      </div>
                      <span className="text-[9px] px-1.5 py-0.2 bg-emerald-950 text-emerald-300 rounded border border-emerald-500/20 font-mono">
                        {nd.badge}
                      </span>
                    </div>
                    <h4 className="text-[11px] font-semibold text-slate-100">{nd.title}</h4>
                    <p className="text-[10px] font-mono text-slate-400 leading-snug truncate">{nd.desc}</p>
                  </button>
                );
              })()}
            </div>

          </div>

        </div>
      </div>

      {/* Node Inspector Property Panel Drawer */}
      <div className="border-t border-slate-800 bg-slate-950/90 p-4 md:p-6 select-none shadow-inner">
        <div className="flex flex-col gap-4">
          
          {/* Drawer Header Indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-electric-blue" />
              <span className="text-xs font-medium text-slate-400">
                Step Inspector: <span className="text-white">{pipelineSteps.find(s => s.id === selectedNodeId)?.label} Config</span>
              </span>
            </div>
            
            {/* Context action based on node status */}
            {["splitting", "peft", "conversion", "pruning", "transformer_opt", "quantization"].includes(selectedNodeId) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-mono">Include in recipe:</span>
                <Button 
                  variant={pipelineSteps.find(s => s.id === selectedNodeId)?.active ? "danger" : "success"}
                  onClick={() => togglePassState(selectedNodeId)}
                  className="h-7 text-[10px] px-3 font-semibold"
                >
                  {pipelineSteps.find(s => s.id === selectedNodeId)?.active ? <X className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                  {pipelineSteps.find(s => s.id === selectedNodeId)?.active ? "Skip Pass" : "Activate Pass"}
                </Button>
              </div>
            )}
          </div>

          {advisories.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-300">
                  {advisories.length} performance note{advisories.length === 1 ? "" : "s"}
                </span>
              </div>
              {advisories.slice(0, 2).map((issue) => (
                <p key={issue.id} className="text-[11px] text-slate-400 leading-relaxed">
                  {issue.description}
                </p>
              ))}
            </div>
          )}

          {validation.issues.some((issue) => issue.autofix) && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
                <span className="text-xs font-bold text-rose-300">
                  Incompatible settings detected — use Fix to auto-correct
                </span>
              </div>
              <div className="space-y-2">
                {validation.issues.filter((issue) => issue.autofix).slice(0, 3).map((issue) => (
                  <div key={issue.id} className="flex items-start justify-between gap-2">
                    <p className="text-[11px] text-slate-400 leading-relaxed">{issue.title}</p>
                    {issue.actionLabel && (
                      <Button
                        variant="outline"
                        className="h-6 text-[9px] px-2 shrink-0"
                        onClick={() => setState(applyIssueAutofix(state, issue))}
                      >
                        Fix
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-900 min-h-[90px] flex flex-col justify-center">
            
            {/* Input Node Properties Control */}
            {selectedNodeId === "input" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
                    <Database className="h-3.5 w-3.5 text-electric-blue" />
                    Input Framework Model Source
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Loads baseline weights into PyTorch abstract structure. Model is parsed into computational nodes before launching the Olive engine execution cascade.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 border-l border-slate-800/50 pl-4">
                  <div>
                    <Label className="text-[10px] font-mono text-slate-400">Selected Source</Label>
                    <Select 
                      value={state.modelSource} 
                      onChange={(e) => setState({ modelSource: e.target.value as any })}
                      className="h-8 text-xs bg-slate-950"
                    >
                      <option value="huggingface">HuggingFace Hub Registry</option>
                      <option value="azure">AzureML Asset Workspace</option>
                      <option value="local">Local Directory Framework Weights</option>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Model Splitting Properties Control */}
            {selectedNodeId === "splitting" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Workflow className="h-3.5 w-3.5 text-amber-500" />
                    Multi-Device Model Splitting
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Partitions massive multi-billion parameter networks across pipeline boundaries to process layers parallelly on low-compute edge devices.
                  </p>
                </div>
                <div className="border-l border-slate-800/50 pl-4 flex flex-col justify-center">
                  {state.passes.splitting ? (
                    <div className="p-3 bg-slate-950/80 rounded border border-slate-800 flex items-center gap-3">
                      <div className="p-1.5 rounded-full bg-amber-500/10">
                        <Check className="h-4 w-4 text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-bold text-slate-200">Balanced Split Pipeline</div>
                        <div className="text-[10px] text-slate-400 leading-tight">Layers subdivided evenly according to memory footprint coefficients.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center text-xs text-slate-500 font-mono italic">
                      Model Splitting is disabled. Model is compiled as a unified single binary file.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PEFT Tuning Properties Control */}
            {selectedNodeId === "peft" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5 text-electric-blue" />
                    Parameter-Efficient Fine-Tuning (PEFT)
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Applies custom LoRA or QLoRA adapter layers to freeze the base model parameters while adding a small pool of trainable weights. Perfect for rapid target style training before freezing.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 border-l border-slate-800/50 pl-4">
                  {state.passes.peft ? (
                    <>
                      <div>
                        <Label className="text-[10px] font-mono text-slate-400">Tuning Method</Label>
                        <Select 
                          value={state.passes.peftMethod} 
                          onChange={(e) => setState({ passes: { ...state.passes, peftMethod: e.target.value as any }})}
                          className="h-8 text-xs bg-slate-950"
                        >
                          <option value="lora">LoRA Standard Adapters</option>
                          {allowedPeftMethods.includes("qlora") && (
                            <option value="qlora">QLoRA Quantized Adapters</option>
                          )}
                        </Select>
                      </div>
                      <div className="bg-slate-950 border border-slate-900/60 p-2.5 rounded text-center">
                        <div className="text-[10px] text-slate-500 font-mono uppercase">Trainable Params</div>
                        <div className="text-xs font-bold text-electric-blue font-mono mt-0.5">~0.08% Coefs</div>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 flex items-center justify-center text-xs text-slate-500 font-mono italic">
                      PEFT adapter tuning is bypassed. Model weights are static baseline.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Conversion Node Properties Control */}
            {selectedNodeId === "conversion" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
                    <Workflow className="h-3.5 w-3.5 text-electric-blue" />
                    Graph Assembly Compiler Target
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Compiles native weights (PyTorch/TensorFlow) into optimized runtime formats. This unrolls tensor subroutines into static flow graphs used by ONNX Runtime.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 border-l border-slate-800/50 pl-4">
                  {state.passes.conversion ? (
                    <>
                      <div>
                        <Label className="text-[10px] font-mono text-slate-400">Target Framework Format</Label>
                        <Select 
                          value={state.passes.conversionFormat} 
                          onChange={(e) => setState({ passes: { ...state.passes, conversionFormat: e.target.value as any }})}
                          className="h-8 text-xs bg-slate-950"
                        >
                          <option value="onnx">ONNX Graph Runtime</option>
                          {allowedConversionFormats.includes("openvino") && (
                            <option value="openvino">Intel OpenVINO IR</option>
                          )}
                        </Select>
                      </div>
                      {state.passes.conversionFormat === "onnx" && (
                        <div>
                          <Label className="text-[10px] font-mono text-slate-400">ONNX Graph Opset</Label>
                          <Select 
                            value={String(state.passes.conversionOpset)} 
                            onChange={(e) => setState({ passes: { ...state.passes, conversionOpset: Number(e.target.value) }})}
                            className="h-8 text-xs bg-slate-950"
                          >
                            <option value="14">Opset v14</option>
                            <option value="15">Opset v15</option>
                            <option value="16">Opset v16</option>
                            <option value="17">Opset v17</option>
                          </Select>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="col-span-2 flex items-center justify-center text-xs text-slate-500 font-mono italic">
                      Graph Conversion is skipped. PyTorch weights will be optimized in baseline.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pruning Properties Control */}
            {selectedNodeId === "pruning" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Minimize2 className="h-3.5 w-3.5 text-amber-500" />
                    Neural Connection Sparsity Pruning
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Zeroes out redundant or minimal weights, compiling standard models down by specific ratios. Sparse representations offer major speed gains.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 border-l border-slate-800/50 pl-4">
                  {state.passes.pruning ? (
                    <>
                      <div className="col-span-2 flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <Label className="text-[10px] font-mono text-slate-400">Global Sparsity Ratio</Label>
                          <span className="text-[11px] font-bold text-amber-400 font-mono">{String((state.passes.pruningSparsity * 100).toFixed(0))}%</span>
                        </div>
                        <Slider 
                          value={[state.passes.pruningSparsity]} 
                          onValueChange={(val) => setState({ passes: { ...state.passes, pruningSparsity: val[0] }})}
                          min={0.10} 
                          max={0.90} 
                          step={0.05} 
                          className="h-2 py-2"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] font-mono text-slate-400">Algorithmic Method</Label>
                        <Select 
                          value={state.passes.pruningMethod} 
                          onChange={(e) => setState({ passes: { ...state.passes, pruningMethod: e.target.value as any }})}
                          className="h-8 text-[11px] bg-slate-950"
                        >
                          <option value="sparsegpt">SparseGPT (Reconstructed)</option>
                          <option value="wanda">Wanda (Weights & Activations)</option>
                          <option value="magnitude">Basic L1/L2 Magnitude</option>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px] font-mono text-slate-400">Sparsity Profile</Label>
                        <Select 
                          value={state.passes.pruningType} 
                          onChange={(e) => setState({ passes: { ...state.passes, pruningType: e.target.value as any }})}
                          className="h-8 text-[11px] bg-slate-950"
                        >
                          <option value="unstructured">Unstructured Layout</option>
                          {allowedPruningTypes.includes("structured") && (
                            <option value="structured">Structured 2:4 Pattern</option>
                          )}
                        </Select>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 flex items-center justify-center text-xs text-slate-500 font-mono italic">
                      Weight Pruning is disabled. Core layers retain 100% density.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ORT Transform Attention fusion Properties Control */}
            {selectedNodeId === "transformer_opt" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5 text-slate-400" />
                    ONNX Runtime Layout Fusion Operators
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Combines individual operators (like Attention fusions, GeLU joins) into highly-optimized unified kernels natively executed by target accelerators.
                  </p>
                </div>
                <div className="border-l border-slate-800/50 pl-4 flex flex-col justify-center">
                  {state.passes.onnxTransforms ? (
                    <div className="p-3 bg-slate-950/80 rounded border border-slate-800 flex items-center gap-3">
                      <div className="p-1.5 rounded-full bg-slate-800/50">
                        <Check className="h-4 w-4 text-slate-400" />
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-bold text-slate-200">Active Stage Fusions</div>
                        <div className="text-[10px] text-slate-400 leading-tight">Attention blocks, bias layernorms, and softmax routines fused dynamically.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center text-xs text-slate-500 font-mono italic">
                      ORT Optimization passes are disabled. Computational graphs preserve base node steps.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quantization Properties Control */}
            {selectedNodeId === "quantization" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                    Weight Integer Compression Quantization
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Compresses floating-point weight dimensions (FP32/FP16) down to small 4-bit or 8-bit registers, drastically reducing model foot-print and memory usage.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 border-l border-slate-800/50 pl-4">
                  {state.passes.quantization ? (
                    <>
                      <div>
                        <Label className="text-[10px] font-mono text-slate-400">Target Precision Bitrate</Label>
                        <Select 
                          value={state.passes.quantPrecision} 
                          onChange={(e) => setState({ passes: { ...state.passes, quantPrecision: e.target.value as any }})}
                          className="h-8 text-xs bg-slate-950"
                        >
                          <option value="int4">4-bit INT integer (Highly Compressed)</option>
                          <option value="int8">8-bit INT integer (Industry Standard)</option>
                          <option value="fp16">16-bit Float precision (Half Fidelity)</option>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px] font-mono text-slate-400">Method Strategy</Label>
                        <Select 
                          value={state.passes.quantMethod} 
                          onChange={(e) => setState({ passes: { ...state.passes, quantMethod: e.target.value as any }})}
                          className="h-8 text-xs bg-slate-950"
                        >
                          <option value="ptq">PTQ (Post-Training Quantization)</option>
                          {allowedQuantMethods.includes("awq") && (
                            <option value="awq">AWQ (Activation-Aware Weights)</option>
                          )}
                          {allowedQuantMethods.includes("qat") && (
                            <option value="qat">QAT (Quantization-Aware Training)</option>
                          )}
                        </Select>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 flex items-center justify-center text-xs text-slate-500 font-mono italic">
                      Model Quantization is disabled. Model remains in native floating point (FP16/FP32).
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Target Hardware Provider Properties Control */}
            {selectedNodeId === "provider" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <TargetIcon className="h-3.5 w-3.5 text-electric-blue" />
                    Target Hardware System Accelerator
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Selects native execution platform accelerators for testing and deployment targets. Configures execution context flags based on selected silicon profile.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 border-l border-slate-800/50 pl-4">
                  <div>
                    <Label className="text-[10px] font-mono text-slate-400">Active Platform Driver</Label>
                    <Select 
                      value={state.ihvProvider} 
                      onChange={(e) => setState({ ihvProvider: e.target.value as any })}
                      className="h-8 text-xs bg-slate-950"
                    >
                      <option value="CUDAExecutionProvider">Intel/AMD/NVIDIA CUDA Host GPU</option>
                      <option value="TensorrtExecutionProvider">NVIDIA CUDA High-Performance TensorRT</option>
                      <option value="CPUExecutionProvider">Standard x86/ARM Base CPU System</option>
                      <option value="OpenVINOExecutionProvider">Intel Core OpenVINO Engine</option>
                      <option value="QNNExecutionProvider">Qualcomm Snapdragon QNN NPU</option>
                      <option value="ROCMExecutionProvider">AMD Instinct ROCm Acceleration</option>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Optimized Output Properties and Estimate statistics Control */}
            {selectedNodeId === "output" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
                    <Package className="h-3.5 w-3.5 text-emerald-400" />
                    Finalized Optimized Deployment Runtime Package
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Once compilation is executed, your finalized binary assets, runtime drivers, and system environment setups are bundled together for immediate deployment.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 border-l border-slate-800/50 pl-4 items-center">
                  <div className="col-span-2 text-[10px] text-amber-400/90 font-mono uppercase tracking-wide bg-amber-500/5 border border-amber-500/15 rounded px-2 py-1">
                    Simulated heuristics — not profiled. Run Olive for real metrics.
                  </div>
                  <div className="bg-slate-950 border border-slate-800 p-2.5 rounded text-center">
                    <div className="text-[10px] text-slate-500 font-mono uppercase">Sim. Size (heuristic)</div>
                    <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                      {state.passes.quantization && state.passes.quantPrecision === "int4" 
                        ? "~1.40 GB" 
                        : state.passes.quantization && state.passes.quantPrecision === "int8" 
                          ? "~2.80 GB" 
                          : "~14.0 GB"}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 p-2.5 rounded text-center col-span-1">
                    <div className="text-[10px] text-slate-500 font-mono uppercase">Sim. Latency (heuristic)</div>
                    <div className="text-sm font-bold text-electric-blue/80 font-mono mt-0.5">
                      {state.passes.quantization 
                        ? state.passes.quantPrecision === "int4" ? "~-84% (est.)" : "~-68% (est.)"
                        : state.passes.pruning ? "~-34% (est.)" : "Not estimated"}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Quick info-bar explaining integration details */}
          <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-900/30 px-3 py-2 rounded-md border border-slate-900 leading-relaxed font-sans mt-1">
            <Info className="h-3.5 w-3.5 text-electric-blue shrink-0 mt-0.5" />
            <p>
              This live dependency network view maps the active <strong>Microsoft Olive compiler pipeline specification</strong>. Click any node to open its parameters, toggling inclusion or adjusting coefficients, which directly synchronizes the JSON recipe generator below.
            </p>
          </div>

        </div>
      </div>

    </div>
  );
}
