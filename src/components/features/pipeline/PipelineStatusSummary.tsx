import { AlertCircle, AlertTriangle, CheckCircle2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import type { UIState } from "@/types";
import type { PipelineValidationResult } from "@/lib/pipelineValidation";
import { getEffectiveModelSource } from "@/lib/modelSource";

type StatusTone = "error" | "warning" | "success";

interface PipelineStatusSummaryProps {
  state: UIState;
  validation: PipelineValidationResult;
  modelSelected: boolean;
  onSelectModel: () => void;
  onResolveIssues: () => void;
  onReviewRun: () => void;
}

interface PrimaryAction {
  label: string;
  handler: () => void;
}

const STATUS_ICON: Record<StatusTone, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
};

const STATUS_ICON_COLOR: Record<StatusTone, string> = {
  error: "text-rose-400",
  warning: "text-amber-400",
  success: "text-emerald-400",
};

const STATUS_BADGE_CLASS: Record<StatusTone, string> = {
  error: "border-rose-500/30 bg-rose-500/10",
  warning: "border-amber-500/30 bg-amber-500/10",
  success: "border-emerald-500/30 bg-emerald-500/10",
};

const STATUS_LABEL_CLASS: Record<StatusTone, string> = {
  error: "text-rose-400 cursor-pointer",
  warning: "text-amber-400 cursor-pointer",
  success: "text-emerald-400",
};

function truncateLabel(label: string, maxLength = 48): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 3)}...`;
}

function getModelLabel(state: UIState): string {
  const source = getEffectiveModelSource(state);
  if (source === null) return "No model selected";
  if (source === "huggingface") return truncateLabel(state.hfModelId);
  if (source === "azure") return truncateLabel(state.azureModelPath);
  if (source === "local") {
    if (state.localFiles.length === 1) return truncateLabel(state.localFiles[0].name);
    if (state.localFiles.length > 1) {
      return truncateLabel(`${state.localFiles[0].name} +${state.localFiles.length - 1} more`);
    }
  }
  return "No model selected";
}

function getProviderName(providerId: string): string {
  return (
    PROVIDER_CATALOG.find((p) => p.id === providerId)?.shortName ??
    providerId.replace("ExecutionProvider", "")
  );
}

function getStatusTone(validation: PipelineValidationResult): StatusTone {
  if (validation.isBlocked) return "error";
  if (validation.warningCount > 0) return "warning";
  return "success";
}

function getPrimaryAction(
  modelSelected: boolean,
  validation: PipelineValidationResult,
  onSelectModel: () => void,
  onResolveIssues: () => void,
  onReviewRun: () => void,
): PrimaryAction {
  if (!modelSelected) {
    return { label: "Select a model", handler: onSelectModel };
  }
  if (validation.isBlocked) {
    const issueWord = validation.criticalCount === 1 ? "issue" : "issues";
    return {
      label: `Resolve ${validation.criticalCount} ${issueWord}`,
      handler: onResolveIssues,
    };
  }
  return { label: "Review recipe & run", handler: onReviewRun };
}

export function PipelineStatusSummary({
  state,
  validation,
  modelSelected,
  onSelectModel,
  onResolveIssues,
  onReviewRun,
}: PipelineStatusSummaryProps) {
  const effectiveModelSource = getEffectiveModelSource(state);
  const effectiveModelSelected = effectiveModelSource !== null;
  const modelLabel = getModelLabel(state);
  const providerLabel = getProviderName(state.ihvProvider);
  const statusTone = getStatusTone(validation);
  const StatusIcon = STATUS_ICON[statusTone];
  const { label: actionLabel, handler: actionHandler } = getPrimaryAction(
    modelSelected,
    validation,
    onSelectModel,
    onResolveIssues,
    onReviewRun,
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-950 border-b border-slate-800">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            STATUS_BADGE_CLASS[statusTone],
          )}
        >
          <StatusIcon className={cn("h-4 w-4", STATUS_ICON_COLOR[statusTone])} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 truncate max-w-[18rem] sm:max-w-[28rem] lg:max-w-[40rem]">
            {effectiveModelSelected ? "Model" : "Task summary"}:{" "}
            <span className={cn("font-medium", effectiveModelSelected ? "text-slate-200" : "text-rose-400")}>
              {modelLabel}
            </span>
          </p>
          {effectiveModelSelected && (
            <p className="text-[11px] text-slate-500 truncate max-w-[18rem] sm:max-w-[28rem] lg:max-w-[40rem]">
              Target: <span className="font-medium text-slate-300">{providerLabel}</span>
              {validation.statusLabel && (
                <>
                  {" · "}
                  {statusTone === "success" ? (
                    <span
                      className={cn(
                        "ml-1 inline-flex items-center gap-1 font-medium",
                        STATUS_LABEL_CLASS.success,
                      )}
                    >
                      {validation.statusLabel}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={statusTone === "error" ? onResolveIssues : actionHandler}
                      className={cn(
                        "ml-1 inline-flex items-center gap-1 font-medium hover:underline",
                        STATUS_LABEL_CLASS[statusTone],
                      )}
                      aria-label={
                        statusTone === "error" ? "Jump to blocking issues" : "Review validation warnings"
                      }
                    >
                      {validation.statusLabel}
                    </button>
                  )}
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
