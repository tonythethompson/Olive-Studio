import type { PassGuidance } from "@/lib/passGuidance";
import { CheckCircle2, XCircle } from "lucide-react";

interface PassGuidanceCardProps {
  guidance: PassGuidance;
}

export function PassGuidanceCard({ guidance }: PassGuidanceCardProps) {
  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-4 space-y-4">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-wider text-electric-blue/80 mb-1">
          About this pass
        </p>
        <h4 className="text-sm font-semibold text-slate-100 leading-snug">{guidance.title}</h4>
        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{guidance.summary}</p>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed border-l-2 border-slate-700 pl-3">
        {guidance.whatItDoes}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-500/90 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Use when
          </p>
          <ul className="space-y-1.5">
            {guidance.whenToUse.map((item) => (
              <li key={item} className="text-xs text-slate-400 leading-relaxed pl-0.5">
                {item}
              </li>
            ))}
          </ul>
        </div>

        {guidance.whenNotToUse.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-amber-500/90 flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5" />
              Skip when
            </p>
            <ul className="space-y-1.5">
              {guidance.whenNotToUse.map((item) => (
                <li key={item} className="text-xs text-slate-500 leading-relaxed pl-0.5">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
