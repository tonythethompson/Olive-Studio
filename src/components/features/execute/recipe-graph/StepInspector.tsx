import { Button } from "@/components/ui";
import { GraphConflictBanner } from "@/components/features/execute/GraphConflictBanner";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { getPipelineValidation } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import { Info, Plus, Settings, X } from "lucide-react";
import { getPassToggleBlockReason, isToggleablePass, togglePassInState } from "./graphPassControls";
import { getPassGuidanceForNode } from "@/lib/passGuidance";
import { PassGuidanceCard } from "./PassGuidanceCard";
import { ConversionInspector } from "./inspectors/ConversionInspector";
import { InputInspector } from "./inspectors/InputInspector";
import { OrtTransformsInspector } from "./inspectors/OrtTransformsInspector";
import { OutputInspector } from "./inspectors/OutputInspector";
import { PeftInspector } from "./inspectors/PeftInspector";
import { ProviderInspector } from "./inspectors/ProviderInspector";
import { PruningInspector } from "./inspectors/PruningInspector";
import { QuantizationInspector } from "./inspectors/QuantizationInspector";
import { SplittingInspector } from "./inspectors/SplittingInspector";

interface StepInspectorProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  selectedNodeId: string;
  pipelineSteps: { id: string; label: string; active: boolean }[];
}

export function StepInspector({ state, setState, selectedNodeId, pipelineSteps }: StepInspectorProps) {
  const { data: hardwareProbe = null } = useHardwareProbe();

  const validation = getPipelineValidation(state, { hardwareProbe });
  // Derive advisories from the validation already computed above —
  // getRemainingAdvisories would re-run the entire validation pass.
  const advisories = validation.issues.filter((issue) => issue.severity === "warning" && !issue.autofix);
  const autofixIssues = validation.issues.filter((issue) => issue.autofix);

  const selectedStep = pipelineSteps.find((s) => s.id === selectedNodeId);
  const isPassNode = isToggleablePass(selectedNodeId);
  const activating = isPassNode && !selectedStep?.active;
  const toggleBlockReason = isPassNode ? getPassToggleBlockReason(selectedNodeId, state, activating) : null;

  const handleTogglePass = () => {
    if (!isPassNode || toggleBlockReason) return;
    setState({ passes: togglePassInState(state, selectedNodeId) });
  };

  const passGuidance = getPassGuidanceForNode(selectedNodeId, state);

  return (
    <div className="border-t border-slate-800 bg-slate-950/90 p-3 md:p-4 select-none shadow-inner">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-electric-blue" />
            <span className="text-sm font-medium text-slate-400">
              Step Inspector: <span className="text-white">{selectedStep?.label} Config</span>
            </span>
          </div>

          {isPassNode && (
            <div className="flex items-center gap-2 flex-wrap">
              {toggleBlockReason && (
                <span className="text-[11px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded">
                  {toggleBlockReason}
                </span>
              )}
              <span className="text-sm text-slate-500 font-mono">Include in recipe:</span>
              <Button
                variant={selectedStep?.active ? "danger" : "success"}
                onClick={handleTogglePass}
                disabled={Boolean(toggleBlockReason)}
                className="h-7 text-[11px] px-3 font-semibold"
              >
                {selectedStep?.active ? <X className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                {selectedStep?.active ? "Skip Pass" : "Activate Pass"}
              </Button>
            </div>
          )}
        </div>

        <GraphConflictBanner
          state={state}
          setState={setState}
          autofixIssues={autofixIssues}
          advisories={advisories}
        />

        {passGuidance && <PassGuidanceCard guidance={passGuidance} />}

        <div className="bg-slate-900/40 rounded-lg p-3 md:p-3.5 border border-slate-900 min-h-[70px] flex flex-col justify-center">
          {selectedNodeId === "input" && <InputInspector state={state} setState={setState} />}
          {selectedNodeId === "splitting" && <SplittingInspector state={state} setState={setState} />}
          {selectedNodeId === "peft" && <PeftInspector state={state} setState={setState} />}
          {selectedNodeId === "conversion" && <ConversionInspector state={state} setState={setState} />}
          {selectedNodeId === "pruning" && <PruningInspector state={state} setState={setState} />}
          {selectedNodeId === "transformer_opt" && (
            <OrtTransformsInspector state={state} setState={setState} />
          )}
          {selectedNodeId === "quantization" && <QuantizationInspector state={state} setState={setState} />}
          {selectedNodeId === "provider" && <ProviderInspector state={state} setState={setState} />}
          {selectedNodeId === "output" && <OutputInspector state={state} setState={setState} />}
        </div>

        <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-900/30 px-2.5 py-1.5 rounded-md border border-slate-900 leading-relaxed font-sans">
          <Info className="h-3.5 w-3.5 text-electric-blue shrink-0 mt-0.5" />
          <p>
            This live dependency network maps the active <strong>Microsoft Olive compiler pipeline</strong>.
            Click any node to configure passes; changes sync to the JSON recipe below.
          </p>
        </div>
      </div>
    </div>
  );
}
