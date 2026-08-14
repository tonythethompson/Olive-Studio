import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";
import type { AgentOutcome, ActivityLogEntry } from "@/lib/types/agentTypes";
import { ModeToggle } from "./ModeToggle";
import { ExportReportMenu } from "./ExportReportMenu";
import { AgentConfirmDialog } from "./AgentConfirmDialog";
import { AgentControls } from "./AgentControls";
import { ActivityLog } from "./ActivityLog";

export interface AgentModeSectionProps {
  agentMode: "manual" | "agent";
  onModeChange: (mode: "manual" | "agent") => void;
  isRunning: boolean;
  records: JobHistoryRecord[];
  confirmDialogOpen: boolean;
  onConfirmDialog: () => void;
  onCancelDialog: () => void;
  agentRunning: boolean;
  onStartAgent: () => void;
  onStopAgent: () => Promise<void>;
  outcome: AgentOutcome | undefined;
  entries: ActivityLogEntry[];
}

/**
 * Agent execution section: mode toggle header, export report menu, the switch-
 * away confirmation dialog, and the agent controls + activity log card.
 */
export function AgentModeSection({
  agentMode,
  onModeChange,
  isRunning,
  records,
  confirmDialogOpen,
  onConfirmDialog,
  onCancelDialog,
  agentRunning,
  onStartAgent,
  onStopAgent,
  outcome,
  entries,
}: AgentModeSectionProps) {
  return (
    <>
      {/* Mode Toggle: Manual / Agent */}
      <div className="flex items-center justify-between">
        <ModeToggle
          mode={agentMode}
          onModeChange={onModeChange}
          disabled={isRunning}
        />
        <ExportReportMenu records={records} />
      </div>

      {/* Agent Confirm Dialog — shown when switching away while agent is running */}
      <AgentConfirmDialog
        open={confirmDialogOpen}
        onConfirm={onConfirmDialog}
        onCancel={onCancelDialog}
      />

      {/* Agent Mode Controls */}
      {agentMode === "agent" && (
        <Card className="border-slate-800 bg-slate-900/40">
          <CardHeader
            title="Agent Execution"
            description="The MCP agent autonomously plans, executes, and diagnoses optimization runs."
          />
          <CardContent className="flex flex-col gap-4 p-4">
            <AgentControls
              agentRunning={agentRunning}
              onStart={onStartAgent}
              onStop={onStopAgent}
              outcome={outcome}
            />
            <ActivityLog entries={entries} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
