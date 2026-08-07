import type { ReactElement } from "react";
import { buildSegmentCurve, type GraphPoint } from "./graphLayout";

export type NodeIssueLevel = "critical" | "warning" | null;

const PASS_NODE_BUTTON_BASE =
  "group text-left p-2.5 rounded-lg border transition-all duration-300 relative flex flex-col justify-between focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

const PASS_NODE_BUTTON_VARIANT: Record<string, string> = {
  "sel-critical": "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500",
  "sel-warning": "border-amber-500 bg-amber-950/10 ring-1 ring-amber-500",
  "sel-ok": "border-electric-blue bg-electric-blue/10 ring-1 ring-electric-blue",
  "unsel-critical": "border-rose-700/60 bg-rose-950/10 hover:border-rose-600",
  "unsel-warning": "border-amber-700/50 bg-amber-950/5 hover:border-amber-600",
  "unsel-ok-on": "border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/60",
  "unsel-ok-off":
    "border-dashed border-slate-400/70 bg-slate-900/35 hover:border-slate-300 hover:bg-slate-900/55",
};

const PASS_NODE_ICON_VARIANT: Record<string, string> = {
  critical: "bg-rose-950/40 border border-rose-700/40 text-rose-400",
  warning: "bg-amber-950/30 border border-amber-700/30 text-amber-400",
  "ok-on": "bg-electric-blue/10 border border-electric-blue/20 text-electric-blue",
  "ok-off": "bg-slate-900 border border-dashed border-slate-400 text-slate-300",
};

const PASS_NODE_STATUS_BADGE_VARIANT: Record<string, string> = {
  critical: "bg-rose-950/40 text-rose-400 border-rose-700/40",
  warning: "bg-amber-950/30 text-amber-400 border-amber-700/30",
  "ok-on": "bg-slate-950 text-electric-blue border-electric-blue/20",
  "ok-off": "bg-slate-950 text-slate-200 border-slate-400 border-dashed",
};

const PASS_NODE_STATUS_LABEL: Record<string, string> = {
  critical: "Conflict",
  warning: "Warning",
  "ok-on": "Active",
  "ok-off": "Off",
};

const ISSUE_DOT_CLASS: Record<"critical" | "warning", string> = {
  critical: "bg-rose-500",
  warning: "bg-amber-400",
};

function passNodeOkVariantKey(issueLevel: NodeIssueLevel, active: boolean | undefined): string {
  if (issueLevel === "critical") return "critical";
  if (issueLevel === "warning") return "warning";
  return active ? "ok-on" : "ok-off";
}

function passNodeButtonKey(
  isSelected: boolean,
  issueLevel: NodeIssueLevel,
  active: boolean | undefined,
): string {
  const sel = isSelected ? "sel" : "unsel";
  if (issueLevel === "critical") return `${sel}-critical`;
  if (issueLevel === "warning") return `${sel}-warning`;
  return isSelected ? "sel-ok" : active ? "unsel-ok-on" : "unsel-ok-off";
}

export function getPassNodeButtonClass(
  isSelected: boolean,
  issueLevel: NodeIssueLevel,
  active: boolean | undefined,
): string {
  return `${PASS_NODE_BUTTON_BASE} ${PASS_NODE_BUTTON_VARIANT[passNodeButtonKey(isSelected, issueLevel, active)]}`;
}

export function getPassNodeIssueDotClass(issueLevel: "critical" | "warning"): string {
  return ISSUE_DOT_CLASS[issueLevel];
}

export function getPassNodeIconClass(issueLevel: NodeIssueLevel, active: boolean | undefined): string {
  return PASS_NODE_ICON_VARIANT[passNodeOkVariantKey(issueLevel, active)];
}

export function getPassNodeStatusBadgeClass(issueLevel: NodeIssueLevel, active: boolean | undefined): string {
  return PASS_NODE_STATUS_BADGE_VARIANT[passNodeOkVariantKey(issueLevel, active)];
}

export function getPassNodeStatusLabel(issueLevel: NodeIssueLevel, active: boolean | undefined): string {
  return PASS_NODE_STATUS_LABEL[passNodeOkVariantKey(issueLevel, active)];
}

export function getPassNodeTitleClass(issueLevel: NodeIssueLevel, active: boolean | undefined): string {
  return active || issueLevel ? "text-slate-100" : "text-slate-300";
}

export interface ConnectionSegmentPathInput {
  fromNodeId: string;
  toNodeId: string;
  hasSkip: boolean;
  parentRect: DOMRect;
  arcYTop: number;
  getConnectionPoints: (fromId: string, toId: string) => { from: GraphPoint; to: GraphPoint } | null;
}

export interface ConnectionSegmentPathResult {
  d: string;
  bypassLane?: { key: string; d: string };
}

export function buildConnectionSegmentPath(
  input: ConnectionSegmentPathInput,
): ConnectionSegmentPathResult | null {
  const { fromNodeId, toNodeId, hasSkip, parentRect, arcYTop, getConnectionPoints } = input;

  if (hasSkip) {
    const points = getConnectionPoints(fromNodeId, toNodeId);
    const dx = points ? points.to.x - points.from.x : 0;
    const dy = points ? points.to.y - points.from.y : 0;
    const useDirectVertical = points && Math.abs(dy) > Math.abs(dx);

    if (useDirectVertical) {
      return { d: buildSegmentCurve(points.from, points.to) };
    }

    const fromElem = document.getElementById(`node-btn-${fromNodeId}`);
    const toElem = document.getElementById(`node-btn-${toNodeId}`);
    if (!fromElem || !toElem) return null;

    const fromR = fromElem.getBoundingClientRect();
    const toR = toElem.getBoundingClientRect();
    const fromX = fromR.left - parentRect.left + fromR.width / 2;
    const fromY = fromR.top - parentRect.top;
    const toX = toR.left - parentRect.left + toR.width / 2;
    const toY = toR.top - parentRect.top;
    const arcY = arcYTop;
    const d = `M ${fromX} ${fromY} C ${fromX} ${arcY}, ${toX} ${arcY}, ${toX} ${toY}`;

    return {
      d,
      bypassLane: {
        key: `bypass-lane-${fromNodeId}-${toNodeId}`,
        d,
      },
    };
  }

  const points = getConnectionPoints(fromNodeId, toNodeId);
  if (!points) return null;
  return { d: buildSegmentCurve(points.from, points.to) };
}

export interface ConnectionSegmentRenderInput {
  fromNodeId: string;
  toNodeId: string;
  d: string;
  hasSkip: boolean;
  showDot: boolean;
  totalDur: number;
  tStart: number;
  tEnd: number;
  tStartBefore: number;
  tEndAfter: number;
}

export function renderBypassLanePath(key: string, d: string): ReactElement {
  return (
    <path
      key={key}
      d={d}
      fill="none"
      stroke="rgba(100, 116, 139, 0.08)"
      strokeWidth="8"
      className="transition-all duration-300"
    />
  );
}

export function renderConnectionSegmentGroup(input: ConnectionSegmentRenderInput): ReactElement {
  const { fromNodeId, toNodeId, d, hasSkip, showDot, totalDur, tStart, tEnd, tStartBefore, tEndAfter } =
    input;

  return (
    <g key={`${fromNodeId}-${toNodeId}`}>
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
    </g>
  );
}
