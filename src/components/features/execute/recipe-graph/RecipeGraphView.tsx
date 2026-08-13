import { useCallback, useEffect, useState } from "react";
import { getSelectedModelInfo } from "@/lib/modelFamily";
import { UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { buildPipelineSteps } from "./graphLayout";
import { GraphCanvas } from "./GraphCanvas";
import { RecipeValidationPanel } from "./RecipeValidationPanel";
import { StepInspector } from "./StepInspector";

export interface RecipeGraphViewProps {
  /** Optional override — defaults to Zustand store */
  state?: UIState;
  setState?: (s: Partial<UIState>) => void;
}

/**
 * Renders the recipe pipeline graph, validation panel, and selected-step inspector.
 *
 * @param state - Optional UI state override; when omitted, state is read from the pipeline store.
 * @param setState - Optional state update handler; when omitted, the pipeline store handler is used.
 */
export function RecipeGraphView({
  state: propState,
  setState: propSetState,
}: RecipeGraphViewProps) {
  const storeState = usePipelineState();
  const state = propState ?? storeState.state;
  const setState = propSetState ?? storeState.setState;

  const [selectedNodeId, setSelectedNodeId] = useState<string>("input");
  const [layoutTick, setLayoutTick] = useState(0);
  const pipelineSteps = buildPipelineSteps(state.passes);

  const bumpLayout = useCallback(() => setLayoutTick((prev) => prev + 1), []);

  /* eslint-disable react-hooks/exhaustive-deps -- state.passes setter + complex dependency expression intentional */
  useEffect(() => {
    const modelInfo = getSelectedModelInfo(state);
    const validValues = modelInfo.types.map((t) => t.value);
    if (!validValues.includes(state.passes.conversionInputTargetTypes) && modelInfo.defaultType) {
      setState({
        passes: { ...state.passes, conversionInputTargetTypes: modelInfo.defaultType },
      });
    }
  }, [
    state.modelSource,
    state.hfModelId,
    state.azureModelPath,
    state.localFiles.length,
    state.localFiles[0]?.name,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className="flex flex-col h-full min-h-[400px] overflow-x-auto">
      <GraphCanvas
        state={state}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        layoutTick={layoutTick}
        onLayoutTick={bumpLayout}
      />
      <div className="px-3 py-1.5 border-t border-slate-900/80">
        <RecipeValidationPanel state={state} setState={setState} />
      </div>
      <StepInspector
        state={state}
        setState={setState}
        selectedNodeId={selectedNodeId}
        pipelineSteps={pipelineSteps}
      />
    </div>
  );
}
