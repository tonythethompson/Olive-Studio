import { BarChart, Bar, XAxis, YAxis, Tooltip as RTTooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui";
import { Zap, Activity, Cpu } from "lucide-react";

const metrics = [
  {
    id: "latency",
    title: "Latency",
    icon: Zap,
    unit: "ms",
    higherIsBetter: false,
    data: [
      { name: "Baseline", value: 45.2, fill: "#64748b" },
      { name: "Optimized", value: 8.4, fill: "#3b82f6" },
    ]
  },
  {
    id: "throughput",
    title: "Throughput",
    icon: Activity,
    unit: "req/s",
    higherIsBetter: true,
    data: [
      { name: "Baseline", value: 22, fill: "#64748b" },
      { name: "Optimized", value: 118, fill: "#10b981" },
    ]
  },
  {
    id: "memory",
    title: "Memory",
    icon: Cpu,
    unit: "MB",
    higherIsBetter: false,
    data: [
      { name: "Baseline", value: 4800, fill: "#64748b" },
      { name: "Optimized", value: 1100, fill: "#8b5cf6" },
    ]
  }
];

export function PerformanceMetrics() {
  return (
    <Card>
      <CardHeader title="Performance Metrics" description="Estimated Pre- vs Post-Optimization hardware metrics." />
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
          {metrics.map(metric => {
            const Icon = metric.icon;
            const baseline = metric.data[0].value;
            const opt = metric.data[1].value;
            const improv = metric.higherIsBetter 
              ? ((opt / baseline) * 100).toFixed(0) + "% higher"
              : ((1 - (opt / baseline)) * 100).toFixed(0) + "% lower";
              
            return (
              <div key={metric.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-slate-400" />
                    <h5 className="text-sm font-semibold text-slate-200">{metric.title}</h5>
                  </div>
                </div>
                
                <div className="h-[140px] w-full mt-2 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metric.data} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="name" stroke="#64748b" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} />
                      <YAxis stroke="#64748b" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} />
                      <RTTooltip 
                        cursor={{fill: '#1e293b', opacity: 0.4}}
                        contentStyle={{ backgroundColor: '#020617', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' }}
                        formatter={(value: number) => [`${value} ${metric.unit}`, metric.title]}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={30}>
                        {metric.data.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 pb-1">
                   <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-slate-500">Delta</span>
                      <span className={`px-1.5 py-0.5 rounded font-medium ${metric.higherIsBetter ? "text-emerald-400 bg-emerald-400/10" : "text-electric-blue bg-electric-blue/10"}`}>
                        {improv}
                      </span>
                   </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
