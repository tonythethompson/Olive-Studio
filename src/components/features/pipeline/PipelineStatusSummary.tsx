import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import type { UIState } from "@/types";
import type { PipelineValidationResult } from "@/lib/pipelineValidation";

interface PipelineStatusSummaryProps {
  state: UIState;
  validation: PipelineValidationResult;
  modelSelected: boolean;
  onSelectModel: () => void;
  onResolveIssues: () => void;
  onReviewRun: () => void;
}

function getModelLabel(state: UIState, modelSelected: boolean): string {
  if (!modelSelected) return "No model selected";
  if (state.modelSource === "huggingface") return state.hfModelId;
  if (state.modelSource === "azure") return state.azureModelPath;
  if (state.localFiles.length > 0) return state.localFiles.map((f) => f.name).join(", ");
  return "No model selected";
}

function getProviderName(providerId: string): string {
  return (
    PROVIDER_CATALOG.find((p) => p.id === providerId)?.shortName ??
    providerId.replace("ExecutionProvider", "")
  );
}

export function PipelineStatusSummary({
  state,
  validation,
  modelSelected,
  onSelectModel,
  onResolveIssues,
  onReviewRun,
}: PipelineStatusSummaryProps) {
  const modelLabel = getModelLabel(state, modelSelected);
  const providerLabel = getProviderName(state.ihvProvider);

  const statusTone = validation.isBlocked ? "error" : validation.warningCount > 0 ? "warning" : "success";
  const statusIcon =
    statusTone === "error" ? (
      <AlertCircle className="h-4 w-4 text-rose-400" />
    ) : statusTone === "warning" ? (
      <AlertTriangle className="h-4 w-4 text-amber-400" />
    ) : (
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    );

  let actionLabel: string;
  let actionHandler: () => void;
  if (!modelSelected) {
    actionLabel = "Select a model";
    actionHandler = onSelectModel;
  } else if (validation.isBlocked) {
    actionLabel = `Resolve ${validation.criticalCount} issue${validation.criticalCount === 1 ? "" : "s"}`;
    actionHandler = onResolveIssues;
  } else {
    actionLabel = "Review recipe & run";
    actionHandler = onReviewRun;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-950 border-b border-slate-800">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", statusTone === "error" ? "border-rose-500/30 bg-rose-500/10" : statusTone === "warning" ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10")}>
          {statusIcon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 truncate max-w-[18rem] sm:max-w-[28rem] lg:max-w-[40rem]">
            {modelSelected ? "Model" : "Task summary"}: {" "}
            <span className={cn("font-medium", modelSelected ? "text-slate-200" : "text-rose-400")}>{modelLabel}</span>
          </p>
          {modelSelected && (
            <p className="text-[11px] text-slate-500 truncate max-w-[18rem] sm:max-w-[28rem] lg:max-w-[40rem]">
              Target: <span className="font-medium text-slate-300">{providerLabel}</span>
              {validation.statusLabel && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={validation.isBlocked ? onResolveIssues : actionHandler}
                    className={cn(
                      "ml-1 inline-flex items-center gap-1 font-medium hover:underline",
                      validation.isBlocked ? "text-rose-400 cursor-pointer" : validation.warningCount > 0 ? "text-amber-400 cursor-pointer" : "text-emerald-400"
                    )}
                    aria-label={validation.isBlocked ? "Jump to blocking issues" : undefined}
                  >
                    {validation.statusLabel}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={actionHandler}
        className="inline-flex items-center justify-center rounded-md bg-electric-blue px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-electric-blue/90 transition-colors shrink-0 cursor-pointer"
      >
        {actionLabel}
      </button>
    </div>
  );
}
