import { Button } from "@/components/ui";
import { applyIssueAutofix, type PipelineIssue } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import { AlertTriangle } from "lucide-react";

interface GraphConflictBannerProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  autofixIssues: PipelineIssue[];
  advisories: PipelineIssue[];
}

export function GraphConflictBanner({
  state,
  setState,
  autofixIssues,
  advisories,
}: GraphConflictBannerProps) {
  return (
    <>
      {advisories.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-bold text-amber-300">
              Performance notes ({advisories.length})
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-1">
            {advisories.map((issue) => (
              <li key={issue.id} className="text-[11px] text-slate-400 leading-relaxed">
                {issue.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {autofixIssues.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            <span className="text-xs font-bold text-rose-300">
              Pass conflicts ({autofixIssues.length})
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            These settings conflict with your hardware target and may fail at run time.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {autofixIssues.map((issue) => (
              <div
                key={issue.id}
                className={`p-3 rounded border flex flex-col justify-between gap-2 ${
                  issue.severity === "critical"
                    ? "border-rose-500/20 bg-rose-950/10"
                    : "border-amber-500/10 bg-amber-950/5"
                }`}
              >
                <div>
                  <p
                    className={`text-xs font-medium ${
                      issue.severity === "critical" ? "text-rose-300" : "text-amber-400"
                    }`}
                  >
                    {issue.title}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{issue.description}</p>
                </div>
                {issue.actionLabel && issue.autofix && (
                  <div className="flex justify-end border-t border-slate-900/50 pt-2">
                    <Button
                      variant="outline"
                      className={`h-7 text-[10px] px-2 ${
                        issue.severity === "critical"
                          ? "border-rose-500/30 text-rose-400"
                          : "border-amber-500/30 text-amber-400"
                      }`}
                      onClick={() => setState(applyIssueAutofix(state, issue))}
                    >
                      Resolve: {issue.actionLabel}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
