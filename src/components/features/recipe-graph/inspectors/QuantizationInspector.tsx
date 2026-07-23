import { Label, Select, Switch } from "@/components/ui";
import { getAllowedQuantMethods } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import type { InspectorProps } from "./types";

interface QuantPreset {
  label: string;
  description: string;
  /** The fields this preset sets on state.passes. Only keys present here are changed. */
  fields: Partial<UIState["passes"]>;
}

const QUANT_PRESETS: QuantPreset[] = [
  {
    label: "Default INT4",
    description: "Post-training INT4 quantization — broadest compatibility",
    fields: {
      quantMethod: "ptq",
      quantPrecision: "int4",
    },
  },
  {
    label: "Default INT8",
    description: "Post-training INT8 — balanced size and accuracy",
    fields: {
      quantMethod: "ptq",
      quantPrecision: "int8",
    },
  },
  {
    label: "AWQ Balanced",
    description: "AWQ INT4 with symmetric 128-group activation-aware quantization",
    fields: {
      quantMethod: "awq",
      quantPrecision: "int4",
      awqGroupSize: 128,
      awqDampPercent: 0.01,
      awqSym: true,
    },
  },
  {
    label: "AWQ High Quality",
    description: "AWQ INT4 with finer 64-group, lower dampening, asymmetric",
    fields: {
      quantMethod: "awq",
      quantPrecision: "int4",
      awqGroupSize: 64,
      awqDampPercent: 0.005,
      awqSym: false,
    },
  },
  {
    label: "GPTQ High Quality",
    description: "GPTQ INT4 with desc_act on, block 128, group 128 — best accuracy",
    fields: {
      quantMethod: "gptq",
      quantPrecision: "int4",
      gptqBlockSize: 128,
      gptqGroupSize: 128,
      gptqDescAct: true,
    },
  },
  {
    label: "GPTQ Fast",
    description: "GPTQ INT4 with desc_act off, block 256, group 128 — fastest",
    fields: {
      quantMethod: "gptq",
      quantPrecision: "int4",
      gptqBlockSize: 256,
      gptqGroupSize: 128,
      gptqDescAct: false,
    },
  },
];

export function QuantizationInspector({ state, setState }: InspectorProps) {
  const allowedQuantMethods = getAllowedQuantMethods(state.ihvProvider);
  const isGptq = state.passes.quantMethod === "gptq";
  const isAwq = state.passes.quantMethod === "awq";

  const handleApplyPreset = (presetLabel: string) => {
    const preset = QUANT_PRESETS.find((p) => p.label === presetLabel);
    if (!preset) return;
    setState({
      passes: { ...state.passes, ...preset.fields },
    });
  };

  if (!state.passes.quantization) {
    return (
      <p className="text-sm text-slate-500 font-mono italic text-center py-4">
        Quantization is skipped — model stays in floating point (FP16/FP32).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Pass settings</p>

      {/* Presets dropdown */}
      <div className="space-y-1.5">
        <Label className="text-xs text-slate-400">Quick presets</Label>
        <Select
          id="quant-presets"
          value=""
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              handleApplyPreset(val);
              e.target.value = "";
            }
          }}
          className="h-9 text-xs bg-slate-950"
        >
          <option value="" disabled>
            Apply a profile…
          </option>
          {QUANT_PRESETS.map((preset) => (
            <option key={preset.label} value={preset.label} title={preset.description}>
              {preset.label} — {preset.description}
            </option>
          ))}
        </Select>
      </div>

      <hr className="border-slate-800" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="quant-target-precision" className="text-xs text-slate-400">
            Target precision
          </Label>
          <Select
            id="quant-target-precision"
            value={state.passes.quantPrecision}
            onChange={(e) =>
              setState({
                passes: {
                  ...state.passes,
                  quantPrecision: e.target.value as UIState["passes"]["quantPrecision"],
                },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            <option value="int4">INT4 — maximum compression</option>
            <option value="int8">INT8 — balanced</option>
            <option value="fp16">FP16 — half precision</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quant-method" className="text-xs text-slate-400">
            Method
          </Label>
          <Select
            id="quant-method"
            value={state.passes.quantMethod}
            onChange={(e) =>
              setState({
                passes: { ...state.passes, quantMethod: e.target.value as UIState["passes"]["quantMethod"] },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            {allowedQuantMethods.includes("ptq") && <option value="ptq">PTQ — post-training</option>}
            {allowedQuantMethods.includes("awq") && <option value="awq">AWQ — activation-aware</option>}
            {allowedQuantMethods.includes("gptq") && <option value="gptq">GPTQ — optimal int4</option>}
            {allowedQuantMethods.includes("qat") && (
              <option value="qat">QAT — quantization-aware training</option>
            )}
          </Select>
        </div>
      </div>

      {isGptq && (
        <>
          <hr className="border-slate-800" />
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            GPTQ advanced settings
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gptq-block-size" className="text-xs text-slate-400">
                Block size
              </Label>
              <Select
                id="gptq-block-size"
                value={String(state.passes.gptqBlockSize)}
                onChange={(e) =>
                  setState({
                    passes: { ...state.passes, gptqBlockSize: Number(e.target.value) },
                  })
                }
                className="h-9 text-xs bg-slate-950"
              >
                <option value="32">32 — fine-grained</option>
                <option value="64">64 — balanced</option>
                <option value="128">128 — default</option>
                <option value="256">256 — coarse</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gptq-group-size" className="text-xs text-slate-400">
                Group size
              </Label>
              <Select
                id="gptq-group-size"
                value={String(state.passes.gptqGroupSize)}
                onChange={(e) =>
                  setState({
                    passes: { ...state.passes, gptqGroupSize: Number(e.target.value) },
                  })
                }
                className="h-9 text-xs bg-slate-950"
              >
                <option value="32">32 — fine</option>
                <option value="64">64 — medium</option>
                <option value="128">128 — default</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gptq-desc-act" className="text-xs text-slate-400">
                Desc. act.
              </Label>
              <div className="flex items-center gap-2 h-9 pt-0.5">
                <Switch
                  id="gptq-desc-act"
                  checked={state.passes.gptqDescAct}
                  onCheckedChange={(checked) =>
                    setState({
                      passes: { ...state.passes, gptqDescAct: checked },
                    })
                  }
                />
                <span className="text-[11px] text-slate-500">
                  {state.passes.gptqDescAct ? "On (slower, more accurate)" : "Off (faster, less accurate)"}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {isAwq && (
        <>
          <hr className="border-slate-800" />
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            AWQ advanced settings
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="awq-group-size" className="text-xs text-slate-400">
                Group size
              </Label>
              <Select
                id="awq-group-size"
                value={String(state.passes.awqGroupSize)}
                onChange={(e) =>
                  setState({
                    passes: { ...state.passes, awqGroupSize: Number(e.target.value) },
                  })
                }
                className="h-9 text-xs bg-slate-950"
              >
                <option value="32">32 — fine</option>
                <option value="64">64 — medium</option>
                <option value="128">128 — default</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="awq-damp-percent" className="text-xs text-slate-400">
                Damp %
              </Label>
              <Select
                id="awq-damp-percent"
                value={String(state.passes.awqDampPercent)}
                onChange={(e) =>
                  setState({
                    passes: { ...state.passes, awqDampPercent: Number(e.target.value) },
                  })
                }
                className="h-9 text-xs bg-slate-950"
              >
                <option value="0.001">0.001 — minimal</option>
                <option value="0.005">0.005 — slight</option>
                <option value="0.01">0.01 — default</option>
                <option value="0.05">0.05 — moderate</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="awq-sym" className="text-xs text-slate-400">
                Symmetric
              </Label>
              <div className="flex items-center gap-2 h-9 pt-0.5">
                <Switch
                  id="awq-sym"
                  checked={state.passes.awqSym}
                  onCheckedChange={(checked) =>
                    setState({
                      passes: { ...state.passes, awqSym: checked },
                    })
                  }
                />
                <span className="text-[11px] text-slate-500">
                  {state.passes.awqSym ? "On (faster, zero-point 0)" : "Off (per-channel zero-point)"}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
