import { useLayoutEffect, useRef, type ReactElement } from "react";
import { getPipelineValidation } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import { buildPipelineSteps, buildSegmentCurve, type GraphPoint } from "./graphLayout";
import { getNodePreviewData } from "./nodePreview";

interface GraphCanvasProps {
  state: UIState;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  showDot: boolean;
  layoutTick: number;
  onLayoutTick: () => void;
}

export function GraphCanvas({
  state,
  selectedNodeId,
  onSelectNode,
  showDot,
  layoutTick,
  onLayoutTick,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pipelineSteps = buildPipelineSteps(state.passes);
  const activeNodes = pipelineSteps.filter((s) => s.active);
  const validation = getPipelineValidation(state);

  const nodeIssueLevel = (nodeId: string): "critical" | "warning" | null => {
    const relevant = validation.issues.filter((i) => i.affectedPasses?.includes(nodeId));
    if (relevant.some((i) => i.severity === "critical")) return "critical";
    if (relevant.some((i) => i.severity === "warning")) return "warning";
    return null;
  };

  useLayoutEffect(() => {
    const handleResize = () => onLayoutTick();
    window.addEventListener("resize", handleResize);
    const r = requestAnimationFrame(() => onLayoutTick());
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
    state.azureModelPath,
    state.localFiles.length,
    state.ihvProvider,
    selectedNodeId,
    onLayoutTick,
  ]);

  void layoutTick;

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

  const renderSVGConnections = () => {
    if (!containerRef.current) return null;

    const paths: ReactElement[] = [];
    const parentRect = containerRef.current.getBoundingClientRect();
    const arcYTop = 28;
    const numSegs = activeNodes.length - 1;
    const totalDur = Math.max(2, numSegs * 0.8);

    for (let i = 0; i < numSegs; i++) {
      const fromNode = activeNodes[i];
      const toNode = activeNodes[i + 1];
      const fromPipelineIdx = pipelineSteps.findIndex((s) => s.id === fromNode.id);
      const toPipelineIdx = pipelineSteps.findIndex((s) => s.id === toNode.id);
      const hasSkip = pipelineSteps.slice(fromPipelineIdx + 1, toPipelineIdx).some((s) => !s.active);

      const tStart = i / numSegs;
      const tEnd = (i + 1) / numSegs;
      const tStartBefore = Math.max(0, tStart - 0.001);
      const tEndAfter = Math.min(1, tEnd + 0.001);

      let d: string;

      if (hasSkip) {
        const points = getConnectionPoints(fromNode.id, toNode.id);
        const dx = points ? points.to.x - points.from.x : 0;
        const dy = points ? points.to.y - points.from.y : 0;
        // Skipped passes in pipeline order, but nodes stack vertically (e.g. conversion → quant):
        // draw a direct down connector instead of arcing over the whole graph.
        const useDirectVertical = points && Math.abs(dy) > Math.abs(dx);

        if (useDirectVertical) {
          d = buildSegmentCurve(points.from, points.to);
        } else {
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

          paths.push(
            <path
              key={`bypass-lane-${fromNode.id}-${toNode.id}`}
              d={d}
              fill="none"
              stroke="rgba(100, 116, 139, 0.08)"
              strokeWidth="8"
              className="transition-all duration-300"
            />,
          );
        }
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
            <circle r={3.5} fill="#8DA840" opacity="0">
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
        </g>,
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

  const renderPassNode = (id: string) => {
    const nd = getNodePreviewData(state, id);
    const isSelected = selectedNodeId === id;
    const active = pipelineSteps.find((s) => s.id === id)?.active;
    const issueLevel = active ? nodeIssueLevel(id) : null;

    return (
      <button
        key={id}
        id={`node-btn-${id}`}
        onClick={() => onSelectNode(id)}
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
          <span
            className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${issueLevel === "critical" ? "bg-rose-500" : "bg-amber-400"}`}
          />
        )}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div
              className={`p-1 rounded ${
                issueLevel === "critical"
                  ? "bg-rose-950/40 border border-rose-700/40 text-rose-400"
                  : issueLevel === "warning"
                    ? "bg-amber-950/30 border border-amber-700/30 text-amber-400"
                    : active
                      ? "bg-electric-blue/10 border border-electric-blue/20 text-electric-blue"
                      : "bg-slate-950 border border-slate-900 text-slate-500"
              }`}
            >
              {nd.icon}
            </div>
            <span
              className={`text-[8px] font-mono px-1 py-0.2 rounded border uppercase whitespace-nowrap ${
                issueLevel === "critical"
                  ? "bg-rose-950/40 text-rose-400 border-rose-700/40"
                  : issueLevel === "warning"
                    ? "bg-amber-950/30 text-amber-400 border-amber-700/30"
                    : active
                      ? "bg-slate-950 text-electric-blue border-electric-blue/20"
                      : "bg-slate-950 text-slate-600 border-slate-900"
              }`}
            >
              {issueLevel === "critical"
                ? "Conflict"
                : issueLevel === "warning"
                  ? "Warning"
                  : active
                    ? "Active"
                    : "Skip"}
            </span>
          </div>
          <h4 className="text-[11px] font-bold text-slate-200 truncate leading-snug">{nd.title}</h4>
          <p className="text-[10px] text-slate-400 leading-tight font-mono line-clamp-2 mt-1 min-h-[20px]">
            {nd.desc}
          </p>
        </div>
      </button>
    );
  };

  const renderProviderOutputNodes = () => {
    const providerNd = getNodePreviewData(state, "provider");
    const outputNd = getNodePreviewData(state, "output");
    const providerIssue = nodeIssueLevel("provider");

    return (
      <>
        <div className="w-full flex flex-col items-center">
          <div className="text-xs text-slate-500 mb-2.5">Target device</div>
          <button
            id="node-btn-provider"
            onClick={() => onSelectNode("provider")}
            className={`group w-full max-w-[240px] text-left p-3.5 rounded-xl border transition-all duration-300 relative ${
              selectedNodeId === "provider"
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
              <span
                className={`absolute top-2 right-2 w-2 h-2 rounded-full ${providerIssue === "critical" ? "bg-rose-500" : "bg-amber-400"}`}
              />
            )}
            <div className="flex items-center justify-between mb-1.5">
              <div className="p-1.5 rounded border border-electric-blue/20 bg-electric-blue/10">
                {providerNd.icon}
              </div>
            </div>
            <h4 className="text-[11px] font-semibold text-slate-100">{providerNd.title}</h4>
            <p className="text-[10px] font-mono text-slate-400 leading-snug truncate">{providerNd.desc}</p>
          </button>
        </div>

        <div className="w-full flex flex-col items-center">
          <div className="text-xs text-slate-500 mb-2.5">Output</div>
          <button
            id="node-btn-output"
            onClick={() => onSelectNode("output")}
            className={`group w-full max-w-[240px] text-left p-3.5 rounded-xl border transition-all duration-300 relative ${
              selectedNodeId === "output"
                ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                : "border-slate-800 hover:border-slate-700 bg-slate-900/60"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                {outputNd.icon}
              </div>
              <span className="text-[9px] px-1.5 py-0.2 bg-emerald-950 text-emerald-300 rounded border border-emerald-500/20 font-mono">
                {outputNd.badge}
              </span>
            </div>
            <h4 className="text-[11px] font-semibold text-slate-100">{outputNd.title}</h4>
            <p className="text-[10px] font-mono text-slate-400 leading-snug truncate">{outputNd.desc}</p>
          </button>
        </div>
      </>
    );
  };

  return (
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
      {/* eslint-disable-next-line react-hooks/refs -- intentional: SVG connections read DOM layout during render (client-side SPA, no SSR) */}
      {renderSVGConnections()}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-y-6 md:gap-3 relative z-10 items-center justify-between h-full w-full min-w-0 md:min-w-[720px]">
        <div className="md:col-span-2 flex flex-col justify-center items-center h-full">
          <div className="text-xs text-slate-500 mb-3">Input</div>
          {(() => {
            const nd = getNodePreviewData(state, "input");
            const isSelected = selectedNodeId === "input";
            return (
              <button
                id="node-btn-input"
                onClick={() => onSelectNode("input")}
                className={`group w-full max-w-[240px] text-left p-4 rounded-xl border transition-all duration-300 relative ${
                  isSelected
                    ? "border-electric-blue bg-electric-blue/10 ring-1 ring-electric-blue"
                    : "border-slate-800 hover:border-slate-700 bg-slate-900/60"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="p-1.5 rounded bg-electric-blue/10 border border-electric-blue/20">
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

        <div className="md:col-span-7 flex flex-col items-center justify-center gap-4 border-l border-r border-slate-900/30 px-4">
          <div className="text-xs text-slate-500 mb-1">Optimization passes</div>
          <div className="grid grid-cols-3 gap-4 w-full">
            {["splitting", "peft", "conversion", "pruning", "transformer_opt", "quantization"].map((id) =>
              renderPassNode(id),
            )}
          </div>
        </div>

        <div className="md:col-span-3 flex flex-col items-center justify-center gap-6 h-full">
          {renderProviderOutputNodes()}
        </div>
      </div>
    </div>
  );
}
