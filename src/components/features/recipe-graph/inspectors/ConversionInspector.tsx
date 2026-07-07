import { Label, Select } from "@/components/ui";
import { getAllowedConversionFormats } from "@/lib/pipelineValidation";
import { getSelectedModelInfo } from "@/lib/modelFamily";
import { UIState } from "@/types";
import type { InspectorProps } from "./types";

export function ConversionInspector({ state, setState }: InspectorProps) {
  const modelInfo = getSelectedModelInfo(state);
  const allowedConversionFormats = getAllowedConversionFormats(state.ihvProvider);

  if (!state.passes.conversion) {
    return (
      <p className="text-sm text-slate-500 font-mono italic text-center py-4">
        Conversion is skipped — weights are not exported to ONNX/OpenVINO in this recipe.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Pass settings</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="conversion-source-format" className="text-xs text-slate-400">Source framework</Label>
          <Select
            id="conversion-source-format"
            value={state.passes.conversionSourceFormat}
            onChange={(e) =>
              setState({
                passes: {
                  ...state.passes,
                  conversionSourceFormat: e.target.value as UIState["passes"]["conversionSourceFormat"],
                },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            <option value="pytorch">PyTorch</option>
            <option value="tensorflow">TensorFlow</option>
            <option value="jax">JAX</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conversion-target-format" className="text-xs text-slate-400">Target format</Label>
          <Select
            id="conversion-target-format"
            value={state.passes.conversionFormat}
            onChange={(e) =>
              setState({
                passes: {
                  ...state.passes,
                  conversionFormat: e.target.value as UIState["passes"]["conversionFormat"],
                },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            <option value="onnx">ONNX</option>
            {allowedConversionFormats.includes("openvino") && (
              <option value="openvino">OpenVINO IR</option>
            )}
          </Select>
        </div>
        {state.passes.conversionFormat === "onnx" && (
          <div className="space-y-1.5">
            <Label htmlFor="conversion-onnx-opset" className="text-xs text-slate-400">ONNX opset</Label>
            <Select
              id="conversion-onnx-opset"
              value={String(state.passes.conversionOpset)}
              onChange={(e) =>
                setState({ passes: { ...state.passes, conversionOpset: Number(e.target.value) } })
              }
              className="h-9 text-xs bg-slate-950"
            >
              <option value="13">13</option>
              <option value="14">14</option>
              <option value="15">15</option>
              <option value="16">16</option>
              <option value="17">17</option>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="conversion-io-dtypes" className="text-xs text-slate-400">I/O dtypes</Label>
          <Select
            id="conversion-io-dtypes"
            value={state.passes.conversionInputTargetTypes}
            onChange={(e) =>
              setState({ passes: { ...state.passes, conversionInputTargetTypes: e.target.value } })
            }
            className="h-9 text-xs bg-slate-950"
          >
            {modelInfo.types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <p className="text-[10px] text-electric-blue/90 font-mono">Detected: {modelInfo.family}</p>
        </div>
      </div>
    </div>
  );
}
