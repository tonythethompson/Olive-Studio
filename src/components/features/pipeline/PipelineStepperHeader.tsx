import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineViewId } from "@/lib/pipelineNavigation";
import type { PipelineValidationResult } from "@/lib/pipelineValidation";

interface PipelineStepperHeaderProps {
  sections: { id: PipelineViewId; step: string; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[];
  activeView: PipelineViewId;
  modelSelected: boolean;
  validation: PipelineValidationResult;
  onNavigate: (id: PipelineViewId) => void;
}

export function PipelineStepperHeader({
  sections,
  activeView,
  modelSelected,
  validation,
  onNavigate,
}: PipelineStepperHeaderProps) {
  const lockedAfterInput = !modelSelected;

  const nextAction = (() => {
    if (!modelSelected) return "Next: Select a model";
    switch (activeView) {
      case "input":
        return "Next: Choose hardware";
      case "ihv":
        return "Next: Review recipe";
      case "execute":
        return validation.isBlocked
          ? `Next: Resolve ${validation.criticalCount} blocking issue${validation.criticalCount === 1 ? "" : "s"}`
          : "Next: Run or queue";
      case "playground":
        return "Next: Test in Playground";
      default:
        return "";
    }
  })();

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-slate-800 bg-slate-950/90">
      <nav aria-label="Pipeline steps" className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar">
        {sections.map(({ id, step, label, icon: Icon }) => {
          const isActive = activeView === id;
          const isLocked = id !== "input" && id !== "playground" && lockedAfterInput;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              disabled={isLocked}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors shrink-0",
                isActive ? "bg-slate-800/80 text-slate-100" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200",
                isLocked && "opacity-50 cursor-not-allowed"
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-mono font-semibold",
                  isActive ? "bg-electric-blue text-slate-950" : "bg-slate-900 text-slate-500 group-hover:text-slate-300"
                )}
              >
                {isActive ? <Check className="h-3 w-3" /> : step}
              </span>
              <Icon className="hidden sm:block h-3.5 w-3.5 shrink-0" />
              <span className="text-xs font-medium whitespace-nowrap">{label}</span>
              {isLocked && <Lock className="h-3 w-3 text-slate-500" />}
            </button>
          );
        })}
      </nav>
      <div className="hidden md:block text-xs text-slate-400 shrink-0">
        <span className="text-slate-500">{nextAction}</span>
      </div>
    </div>
  );
}
