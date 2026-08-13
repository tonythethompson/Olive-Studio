import { useLayoutEffect, useRef, type KeyboardEvent, type ReactElement } from "react";
import { getPipelineValidation } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import { buildPipelineSteps, buildSegmentCurve, type GraphPoint } from "./graphLayout";
import { getNodePreviewData } from "./nodePreview";
import {
  ARROW_MARKER_ID,
  GraphSvgDefs,
  PIPELINE_DOT_SYMBOL_ID,
  WIRE_GRADIENT_ID,
} from "./svgDefs";

/** Left-to-right / reading order for arrow-key graph navigation. */
export const GRAPH_NODE_ORDER = [
  "input",
  "splitting",
  "peft",
  "conversion",
  "pruning",
  "transformer_opt",
  "quantization",
  "provider",
  "output",
] as const;

interface GraphCanvasProps {
  state: UIState;
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  showDot: boolean;
  layoutTick: number;
  onLayoutTick: () => void;
}

/**
 * Renders an interactive graph of the model input, optimization passes, target device, and output.
 *
 * @param state - The current recipe and pipeline state
 * @param selectedNodeId - The identifier of the currently selected graph node
 * @param onSelectNode - Handles selection of a graph node
 * @param showDot - Whether to display animated dots on the connections
 * @param layoutTick - Value used to trigger layout recalculation
 * @param onLayoutTick - Triggers recalculation of the graph layout
 */
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

  const focusNode = (id: string) => {
    onSelectNode(id);
    requestAnimationFrame(() => {
      document.getElementById(`node-btn-${id}`)?.focus();
    });
  };

  const handleNodeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const order = GRAPH_NODE_ORDER as readonly string[];
    const idx = order.indexOf(id);
    if (idx < 0) return;

    if (event.key === "Home") {
      focusNode(order[0]);
      return;
    }
    if (event.key === "End") {
      focusNode(order[order.length - 1]);
      return;
    }

    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const nextIdx = forward ? (idx + 1) % order.length : (idx - 1 + order.length) % order.length;
    focusNode(order[nextIdx]);
  };

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

    /** Shared renderer for a single connection segment (normal or bypass). */
    const renderSegment = (opts: {
      key: string;
      d: string;
      hasSkip: boolean;
      tStart: number;
      tEnd: number;
      tStartBefore: number;
      tEndAfter: number;
    }): ReactElement => (
      <g key={opts.key}>
        <path
          d={opts.d}
          fill="none"
          stroke={opts.hasSkip ? "rgba(141, 168, 64, 0.08)" : "rgba(141, 168, 64, 0.12)"}
          strokeWidth={opts.hasSkip ? 5 : 6}
          className="transition-all duration-300"
        />
        <path
          d={opts.d}
          fill="none"
          stroke={`url(#${WIRE_GRADIENT_ID})`}
          strokeWidth={opts.hasSkip ? 1.5 : 2}
          strokeDasharray="6 6"
          strokeOpacity={opts.hasSkip ? 0.6 : 1}
          className="transition-all duration-300"
          markerEnd={`url(#${ARROW_MARKER_ID})`}
        >
          <animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.7s" repeatCount="indefinite" />
        </path>
        {showDot && (
          <use href={`#${PIPELINE_DOT_SYMBOL_ID}`} opacity="0">
            <animateMotion
              dur={`${totalDur}s`}
              repeatCount="indefinite"
              path={opts.d}
              calcMode="linear"
              keyPoints="0;0;1;1"
              keyTimes={`0;${opts.tStart};${opts.tEnd};1`}
            />
            <animate
              attributeName="opacity"
              dur={`${totalDur}s`}
              repeatCount="indefinite"
              values="0;0;1;1;0;0"
              keyTimes={`0;${opts.tStartBefore};${opts.tStart};${opts.tEnd};${opts.tEndAfter};1`}
            />
          </use>
        )}
      </g>
    );

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

      paths.push(renderSegment({
        key: `${fromNode.id}-${toNode.id}`,
        d,
        hasSkip,
        tStart,
        tEnd,
        tStartBefore,
        tEndAfter,
      }));
    }

    return (
      <svg className="absolute inset-0 pointer-events-none w-full h-full z-0 overflow-visible">
        <defs>
          <GraphSvgDefs />
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
        type="button"
        aria-pressed={isSelected}
        aria-label={`${nd.title}${active ? ", active" : ", off"}${issueLevel ? `, ${issueLevel}` : ""}`}
        tabIndex={isSelected ? 0 : -1}
        onClick={() => focusNode(id)}
        onKeyDown={(event) => handleNodeKeyDown(event, id)}
        className={`group text-left p-2.5 rounded-lg border transition-all duration-300 relative flex flex-col justify-between focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${isSelected
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
                  ? "border-emerald-600/50 bg-emerald-950/10 hover:border-emerald-500 hover:bg-emerald-950/20"
                  : "border-slate-800 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-900/45"
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
              className={`p-1 rounded ${issueLevel === "critical"
                  ? "bg-rose-950/40 border border-rose-700/40 text-rose-400"
                  : issueLevel === "warning"
                    ? "bg-amber-950/30 border border-amber-700/30 text-amber-400"
                    : active
                      ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                      : "bg-slate-900 border border-slate-700 text-slate-500"
                }`}
            >
              {nd.icon}
            </div>
            <span
              className={`text-[11px] font-mono px-1.5 py-0.5 rounded border uppercase whitespace-nowrap tracking-wide ${issueLevel === "critical"
                  ? "bg-rose-950/40 text-rose-400 border-rose-700/40"
                  : issueLevel === "warning"
                    ? "bg-amber-950/30 text-amber-400 border-amber-700/30"
                    : active
                      ? "bg-emerald-950/40 text-emerald-400 border-emerald-600/50"
                      : "bg-slate-950 text-slate-500 border-slate-700"
                }`}
            >
              {issueLevel === "critical"
                ? "Conflict"
                : issueLevel === "warning"
                  ? "Warning"
                  : active
                    ? "Active"
                    : "Off"}
            </span>
          </div>
          <h4
            className={`text-sm font-bold break-words leading-snug ${active || issueLevel ? "text-slate-100" : "text-slate-300"
              }`}
          >
            {nd.title}
          </h4>
          {active && (
            <p className="text-xs leading-tight font-mono mt-1 text-slate-400 break-words">{nd.desc}</p>
          )}
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
          <div className="text-sm text-slate-400 mb-2.5">Target device</div>
          <button
            id="node-btn-provider"
            type="button"
            aria-pressed={selectedNodeId === "provider"}
            aria-label={`${providerNd.title}, target device`}
            tabIndex={selectedNodeId === "provider" ? 0 : -1}
            onClick={() => onSelectNode("provider")}
            onKeyDown={(event) => handleNodeKeyDown(event, "provider")}
            className={`group w-full max-w-[240px] text-left p-3.5 rounded-xl border transition-all duration-300 relative focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${selectedNodeId === "provider"
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
            <h4 className="text-sm font-semibold text-slate-100 break-words">{providerNd.title}</h4>
            <p className="text-xs font-mono text-slate-400 leading-snug break-words">{providerNd.desc}</p>
          </button>
        </div>

        <div className="w-full flex flex-col items-center">
          <div className="text-sm text-slate-400 mb-2.5">Output</div>
          <button
            id="node-btn-output"
            type="button"
            aria-pressed={selectedNodeId === "output"}
            aria-label={`${outputNd.title}, output`}
            tabIndex={selectedNodeId === "output" ? 0 : -1}
            onClick={() => onSelectNode("output")}
            onKeyDown={(event) => handleNodeKeyDown(event, "output")}
            className={`group w-full max-w-[240px] text-left p-3.5 rounded-xl border transition-all duration-300 relative focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${selectedNodeId === "output"
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
            <h4 className="text-sm font-semibold text-slate-100 break-words">{outputNd.title}</h4>
            <p className="text-xs font-mono text-slate-400 leading-snug break-words">{outputNd.desc}</p>
          </button>
        </div>
      </>
    );
  };

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Olive recipe pipeline graph. Tab to the selected node, then use arrow keys to move between nodes."
      className="relative flex-1 min-h-[480px] wide:min-h-[560px] bg-slate-950 p-3 wide:p-6 flex flex-col justify-center select-none overflow-visible"
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

      <div className="grid grid-cols-1 wide:grid-cols-12 gap-y-5 wide:gap-3 relative z-10 items-center justify-between h-full w-full min-w-0 wide:min-w-[720px]">
        <div className="wide:col-span-2 flex flex-col justify-center items-center h-full w-full">
          <div className="text-sm text-slate-400 mb-3">Input</div>
          {(() => {
            const nd = getNodePreviewData(state, "input");
            const isSelected = selectedNodeId === "input";
            return (
              <button
                id="node-btn-input"
                type="button"
                aria-pressed={isSelected}
                aria-label={`${nd.title}, model input`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onSelectNode("input")}
                onKeyDown={(event) => handleNodeKeyDown(event, "input")}
                className={`group w-full max-w-[240px] text-left p-4 rounded-xl border transition-all duration-300 relative focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${isSelected
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
                <h4 className="text-sm font-semibold text-slate-100 mb-1 leading-tight break-words">{nd.title}</h4>
                <p className="text-xs font-mono text-slate-400 leading-relaxed break-words">{nd.desc}</p>
              </button>
            );
          })()}
        </div>

        <div className="wide:col-span-7 flex flex-col items-center justify-center gap-4 wide:border-l wide:border-r border-slate-900/30 px-1 wide:px-4 w-full">
          <div className="text-sm text-slate-400 mb-1">Optimization passes</div>
          <div className="grid grid-cols-2 wide:grid-cols-3 gap-3 wide:gap-4 w-full max-w-xl wide:max-w-none">
            {["splitting", "peft", "conversion", "pruning", "transformer_opt", "quantization"].map((id) =>
              renderPassNode(id),
            )}
          </div>
        </div>

        <div className="wide:col-span-3 flex flex-col items-center justify-center gap-6 h-full w-full">
          {renderProviderOutputNodes()}
        </div>
      </div>
    </div>
  );
}
