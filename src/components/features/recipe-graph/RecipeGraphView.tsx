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
  showDot?: boolean;
}

export function RecipeGraphView({
  state: propState,
  setState: propSetState,
  showDot = true,
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
    <div className="flex flex-col h-full overflow-x-auto">
      <GraphCanvas
        state={state}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        showDot={showDot}
        layoutTick={layoutTick}
        onLayoutTick={bumpLayout}
      />
      <div className="px-3 py-2">
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
