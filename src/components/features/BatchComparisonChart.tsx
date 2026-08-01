/**
 * Grouped bar/radar chart for multi-model metric overlay.
 * Uses recharts (already in deps, vendor-charts chunk).
 */
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";

interface BatchComparisonChartProps {
  records: JobHistoryRecord[];
  chartType?: "bar" | "radar";
}

const COLORS = ["#8DA840", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#34d399"];

function truncateLabel(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function BatchComparisonChart({ records, chartType = "bar" }: BatchComparisonChartProps) {
  const barData = useMemo(
    () =>
      records.map((rec) => ({
        name: truncateLabel(rec.modelId),
        fullName: rec.modelId,
        "Duration (s)": Math.round(rec.durationMs / 100) / 10,
        "VRAM (GB)": rec.vramEstimateGb != null ? Math.round(rec.vramEstimateGb * 10) / 10 : 0,
        Passes: rec.passCount,
      })),
    [records],
  );

  const radarData = useMemo(() => {
    if (records.length === 0) return [];
    const maxDuration = Math.max(...records.map((r) => r.durationMs), 1);
    const maxVram = Math.max(...records.map((r) => r.vramEstimateGb ?? 0), 1);
    const maxPasses = Math.max(...records.map((r) => r.passCount), 1);

    return records.map((rec) => ({
      model: truncateLabel(rec.modelId, 12),
      // Normalize to 0-100 scale (inverted duration: faster = higher)
      Speed: Math.round((1 - rec.durationMs / maxDuration) * 100),
      "VRAM Efficiency": Math.round((1 - (rec.vramEstimateGb ?? 0) / maxVram) * 100),
      "Pass Coverage": Math.round((rec.passCount / maxPasses) * 100),
      Success: rec.status === "completed" ? 100 : 0,
    }));
  }, [records]);

  if (records.length < 2) {
    return (
      <div className="text-xs text-slate-500 py-4 text-center">
        Select at least 2 completed runs to display comparison charts.
      </div>
    );
  }

  if (chartType === "radar") {
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="#334155" />
            <PolarAngleAxis dataKey="model" tick={{ fill: "#94a3b8", fontSize: 10 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 9 }} />
            {["Speed", "VRAM Efficiency", "Pass Coverage", "Success"].map((metric, i) => (
              <Radar
                key={metric}
                name={metric}
                dataKey={metric}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.15}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 6,
                fontSize: 11,
              }}
              labelStyle={{ color: "#e2e8f0" }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            interval={0}
            angle={-15}
            textAnchor="end"
            height={50}
          />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            labelStyle={{ color: "#e2e8f0" }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="Duration (s)" fill={COLORS[0]} radius={[2, 2, 0, 0]} />
          <Bar dataKey="VRAM (GB)" fill={COLORS[1]} radius={[2, 2, 0, 0]} />
          <Bar dataKey="Passes" fill={COLORS[2]} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
