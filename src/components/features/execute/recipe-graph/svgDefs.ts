import { createElement, Fragment } from "react";

export const WIRE_GRADIENT_ID = "wireGradient";
export const ARROW_MARKER_ID = "graphArrowMarker";
export const PIPELINE_DOT_SYMBOL_ID = "pipelineMotionDot";

/** Shared SVG definitions used by every graph connection. */
export function GraphSvgDefs() {
  return createElement(
    Fragment,
    null,
    createElement(
      "linearGradient",
      { id: WIRE_GRADIENT_ID, x1: "0%", y1: "0%", x2: "100%", y2: "0%" },
      createElement("stop", { offset: "0%", stopColor: "#3b82f6" }),
      createElement("stop", { offset: "50%", stopColor: "#8DA840" }),
      createElement("stop", { offset: "100%", stopColor: "#10b981" }),
    ),
    createElement(
      "marker",
      {
        id: ARROW_MARKER_ID,
        viewBox: "0 0 10 10",
        refX: "8",
        refY: "5",
        markerWidth: "6",
        markerHeight: "6",
        orient: "auto-start-reverse",
      },
      createElement("path", {
        d: "M 0 0 L 10 5 L 0 10 z",
        fill: "#8DA840",
        opacity: "0.7",
      }),
    ),
    createElement(
      "symbol",
      { id: PIPELINE_DOT_SYMBOL_ID, overflow: "visible" },
      createElement("circle", { r: "3.5", fill: "#8DA840" }),
    ),
  );
}
