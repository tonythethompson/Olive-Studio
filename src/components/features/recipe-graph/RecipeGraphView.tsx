import { useCallback, useEffect, useState } from "react";
import { getSelectedModelInfo } from "@/lib/modelFamily";
import { UIState } from "@/types";
import { buildPipelineSteps } from "./graphLayout";
import { GraphCanvas } from "./GraphCanvas";
import { StepInspector } from "./StepInspector";

export interface RecipeGraphViewProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  showDot?: boolean;
}

export function RecipeGraphView({ state, setState, showDot = true }: RecipeGraphViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("input");
  const [layoutTick, setLayoutTick] = useState(0);
  const pipelineSteps = buildPipelineSteps(state.passes);

  const bumpLayout = useCallback(() => setLayoutTick((prev) => prev + 1), []);

  useEffect(() => {
    const modelInfo = getSelectedModelInfo(state);
    const validValues = modelInfo.types.map((t) => t.value);
    if (!validValues.includes(state.passes.conversionInputTargetTypes) && modelInfo.defaultType) {
      setState({
        passes: { ...state.passes, conversionInputTargetTypes: modelInfo.defaultType },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.modelSource, state.hfModelId, state.azureModelPath, state.localFiles.length, state.localFiles[0]?.name]);

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
      <StepInspector
        state={state}
        setState={setState}
        selectedNodeId={selectedNodeId}
        pipelineSteps={pipelineSteps}
      />
    </div>
  );
}
