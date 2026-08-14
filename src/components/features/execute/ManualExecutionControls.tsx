import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { type UIState } from "@/types";
import type { PipelineIssue } from "@/lib/pipelineValidation";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import { GpuMetricsBar } from "@/components/features/execute/GpuMetricsBar";
import type { GpuMetrics } from "@/lib/gpuMetrics";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Square,
  Play,
} from "lucide-react";

export type ExecutionStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface ManualExecutionControlsProps {
  state: UIState;
  executionStatus: ExecutionStatus;
  executionExitCode: number | null;
  isRunning: boolean;
  validationLabel: string;
  validationTone: "success" | "warning" | "error";
  schemaErrors: string[];
  advisories: PipelineIssue[];
  isRunnable: boolean;
  justQueued: boolean;
  gpuMetrics: GpuMetrics | null;
  onQueueJob: () => void;
  onExecuteLive: () => void;
  onCancelJob: () => void;
  onOpenAiAudit?: () => void;
  onTestInPlayground: () => void;
  children?: ReactNode;
}

function getExecutionDescription(status: ExecutionStatus, exitCode: number | null) {
  switch (status) {
    case "running":
      return "Olive is running. Streaming optimization logs.";
    case "completed":
      return "Run completed (exit 0)";
    case "failed":
      return `Run failed (exit ${exitCode ?? "?"})`;
    default:
      return "Review recipe above, then execute live or add to batch queue.";
  }
}

function ExecutionStatusBadge({
  executionStatus,
  onOpenAiAudit,
  onTestInPlayground,
}: Pick<ManualExecutionControlsProps, "executionStatus" | "onOpenAiAudit" | "onTestInPlayground">) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {executionStatus === "running" && (
        <span className="flex items-center gap-1.5 text-sm font-mono bg-electric-blue/10 text-electric-blue border border-electric-blue/30 px-2.5 py-1 rounded">
          <RefreshCw className="h-3 w-3 animate-spin" /> Running
        </span>
      )}
      {executionStatus === "completed" && (
        <>
          <span className="flex items-center gap-1.5 text-sm font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded">
            <CheckCircle2 className="h-3 w-3" /> Done
          </span>
          <Button
            variant="outline"
            className="h-8 px-2.5 text-sm border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10"
            onClick={onTestInPlayground}
          >
            Test in Playground →
          </Button>
        </>
      )}
      {executionStatus === "failed" && (
        <span className="flex items-center gap-1.5 text-sm font-mono bg-red-500/10 text-red-400 border border-red-500/30 px-2.5 py-1 rounded">
          <AlertCircle className="h-3 w-3" /> Failed
        </span>
      )}
      <Button
        variant="ghost"
        className="h-8 px-2.5 text-sm text-slate-400 hover:text-electric-blue"
        onClick={() => onOpenAiAudit?.()}
      >
        Review with Assistant
      </Button>
    </div>
  );
}

function RecipeIssues({
  schemaErrors,
  advisories,
}: Pick<ManualExecutionControlsProps, "schemaErrors" | "advisories">) {
  return (
    <>
      {schemaErrors.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 space-y-2">
          {schemaErrors.map((error) => (
            <div key={error} className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-200 leading-relaxed">{error}</p>
            </div>
          ))}
        </div>
      )}
      {advisories.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
          {advisories.map((issue) => (
            <div key={issue.id} className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-300">{issue.title}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{issue.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ValidationSummary({
  validationLabel,
  validationTone,
}: Pick<ManualExecutionControlsProps, "validationLabel" | "validationTone">) {
  const Icon =
    validationTone === "success"
      ? CheckCircle2
      : validationTone === "warning"
        ? AlertTriangle
        : AlertCircle;
  const color =
    validationTone === "success"
      ? "text-emerald-400"
      : validationTone === "warning"
        ? "text-amber-300"
        : "text-rose-300";
  const iconColor =
    validationTone === "success"
      ? "text-emerald-500"
      : validationTone === "warning"
        ? "text-amber-400"
        : "text-rose-400";

  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${iconColor}`} />
      <span className={`text-sm sm:text-sm font-medium ${color}`}>{validationLabel}</span>
    </div>
  );
}

function ExecutionActions({
  isRunning,
  isRunnable,
  justQueued,
  onCancelJob,
  onQueueJob,
  onExecuteLive,
}: Pick<
  ManualExecutionControlsProps,
  "isRunning" | "isRunnable" | "justQueued" | "onCancelJob" | "onQueueJob" | "onExecuteLive"
>) {
  return (
    <div className="flex items-center gap-2 ml-auto">
      {isRunning && (
        <Button
          variant="outline"
          onClick={onCancelJob}
          className="h-9 px-3 text-sm border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500 cursor-pointer"
        >
          <Square className="h-3.5 w-3.5 mr-1.5 fill-rose-400 text-rose-400" /> Cancel Run
        </Button>
      )}
      {justQueued ? (
        <span className="text-sm text-electric-blue font-semibold font-mono mr-2">Queued</span>
      ) : (
        <Button
          variant="outline"
          className="h-9 px-3 text-sm border-dashed border-slate-700 hover:border-electric-blue hover:text-electric-blue disabled:opacity-40"
          onClick={onQueueJob}
          disabled={!isRunnable}
        >
          + Queue
        </Button>
      )}
      <Button
        variant="success"
        onClick={onExecuteLive}
        disabled={isRunning || !isRunnable}
        className="h-9 text-sm"
      >
        {isRunning ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Olive running...
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5 mr-1.5" fill="currentColor" /> Execute Live
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * Active Draft card: status badge, VRAM estimate, schema/advisory issues,
 * validation label, and the execute/cancel/queue controls. Receives the log
 * panel and MCP diagnostic card as children so they stay inside the same card.
 */
export function ManualExecutionControls({
  state,
  executionStatus,
  executionExitCode,
  isRunning,
  validationLabel,
  validationTone,
  schemaErrors,
  advisories,
  isRunnable,
  justQueued,
  gpuMetrics,
  onQueueJob,
  onExecuteLive,
  onCancelJob,
  onOpenAiAudit,
  onTestInPlayground,
  children,
}: ManualExecutionControlsProps) {
  return (
    <Card className="border-slate-800 bg-slate-900/40">
      <CardHeader
        title="Active Draft"
        description={getExecutionDescription(executionStatus, executionExitCode)}
        badge={
          <ExecutionStatusBadge
            executionStatus={executionStatus}
            onOpenAiAudit={onOpenAiAudit}
            onTestInPlayground={onTestInPlayground}
          />
        }
      />
      <CardContent className="flex flex-col gap-4 p-4">
        <VramEstimateBanner state={state} compact />
        <RecipeIssues schemaErrors={schemaErrors} advisories={advisories} />
        <div className="flex justify-between items-center gap-3 flex-wrap sm:flex-nowrap">
          <ValidationSummary validationLabel={validationLabel} validationTone={validationTone} />
          <ExecutionActions
            isRunning={isRunning}
            isRunnable={isRunnable}
            justQueued={justQueued}
            onCancelJob={onCancelJob}
            onQueueJob={onQueueJob}
            onExecuteLive={onExecuteLive}
          />
        </div>
        {/* GPU metrics live bar */}
        {isRunning && gpuMetrics && <GpuMetricsBar metrics={gpuMetrics} />}
        {children}
      </CardContent>
    </Card>
  );
}
