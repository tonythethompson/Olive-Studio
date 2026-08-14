import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigatePipeline } from "@/lib/pipelineNavigation";

interface PipelineSectionGateProps {
  locked: boolean;
  children: React.ReactNode;
  className?: string;
}

export function PipelineSectionGate({ locked, children, className }: PipelineSectionGateProps) {
  return (
    <div className={cn("relative", className)}>
      <div
        className={cn("transition-opacity", locked && "opacity-40")}
        aria-hidden={locked}
        {...(locked ? { inert: true } : {})}
      >
        {children}
      </div>
      {locked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 text-center shadow-xl">
            <Lock className="mx-auto mb-3 h-8 w-8 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-200">Locked until you choose a model</h3>
            <p className="mt-1 text-xs text-slate-500">
              Select a model in Model source to configure hardware and run a recipe.
            </p>
            <button
              type="button"
              onClick={() => navigatePipeline("input")}
              className="mt-4 inline-flex items-center justify-center rounded-md bg-electric-blue px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-electric-blue/90 transition-colors cursor-pointer"
            >
              Select a model
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
