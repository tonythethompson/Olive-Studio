import { Label, Select } from "@/components/ui";
import { Switch } from "@/components/ui/Switch";
import { getAllowedQuantMethods } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import { ImportConfirmDialog } from "./ImportConfirmDialog";
import type { InspectorProps } from "./types";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useAutoClearError, useImportPresets, useExportPresets } from "@/lib/hooks";
import { RecipeDiffOverlay } from "./RecipeDiffOverlay";
import { RefreshCw, AlertTriangle, Save, Download, Upload } from "lucide-react";
import {
  loadCustomPresets,
  saveCustomPreset,
  deleteCustomPreset,
  replaceAllCustomPresets,
  exportPresetsJSON,
  importPresetsJSON,
  type CustomQuantPreset,
} from "@/lib/quantPresets";

// ── Shared sub-components ──────────────────────────────────────────

interface SelectRowProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

function SelectRow({ id, label, value, onChange, children }: SelectRowProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm text-slate-400">
        {label}
      </Label>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 text-sm bg-slate-950"
      >
        {children}
      </Select>
    </div>
  );
}

interface SwitchRowProps {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  labelOn: string;
  labelOff: string;
}

/**
 * Renders a labeled switch with text indicating its current state.
 *
 * @param id - The identifier associated with the switch and its label
 * @param label - The label displayed for the switch
 * @param checked - Whether the switch is enabled
 * @param onCheckedChange - Callback invoked when the switch state changes
 * @param labelOn - Text displayed when the switch is enabled
 * @param labelOff - Text displayed when the switch is disabled
 */
function SwitchRow({ id, label, checked, onCheckedChange, labelOn, labelOff }: SwitchRowProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm text-slate-400">
        {label}
      </Label>
      <div className="flex items-center gap-2 h-9 pt-0.5">
        <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
        <span className="text-xs text-slate-500">{checked ? labelOn : labelOff}</span>
      </div>
    </div>
  );
}

interface AdvancedDropdownProps {
  title: string;
  children: ReactNode;
}

function AdvancedDropdown({ title, children }: AdvancedDropdownProps) {
  return (
    <>
      <hr className="border-slate-800" />
      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{children}</div>
    </>
  );
}

// ── Presets ────────────────────────────────────────────────────────

interface QuantPreset {
  label: string;
  description: string;
  fields: Partial<UIState["passes"]>;
}

/** Build a QuantPreset from the current UI state for tooltip display. */
function getCurrentQuantPreset(state: UIState): QuantPreset {
  const f = state.passes;
  const fields: Partial<UIState["passes"]> = {
    quantMethod: f.quantMethod,
    quantPrecision: f.quantPrecision,
  };
  if (f.quantMethod === "gptq") {
    fields.gptqBlockSize = f.gptqBlockSize;
    fields.gptqGroupSize = f.gptqGroupSize;
    fields.gptqDescAct = f.gptqDescAct;
  } else if (f.quantMethod === "awq") {
    fields.awqGroupSize = f.awqGroupSize;
    fields.awqDampPercent = f.awqDampPercent;
    fields.awqSym = f.awqSym;
  } else if (f.quantMethod === "qat") {
    fields.qatQuantPrecision = f.qatQuantPrecision;
    fields.qatCalibrateMethod = f.qatCalibrateMethod;
    fields.qatCalibrateSteps = f.qatCalibrateSteps;
  }
  return {
    label: "Current",
    description: `Current ${f.quantMethod.toUpperCase()} ${f.quantPrecision} config`,
    fields,
  };
}

/** Format a preset's full config as a structured tooltip string. */
function formatPresetTooltip(preset: QuantPreset): string {
  const f = preset.fields;
  const lines: string[] = [
    preset.description,
    `Method: ${f.quantMethod?.toUpperCase() ?? "PTQ"}`,
    `Precision: ${f.quantPrecision?.toUpperCase() ?? "INT8"}`,
  ];
  if (f.quantMethod === "awq") {
    lines.push(`AWQ group size: ${f.awqGroupSize ?? 128}`);
    lines.push(`AWQ damp %: ${f.awqDampPercent ?? 0.01}`);
    lines.push(`AWQ symmetric: ${f.awqSym ? "on" : "off"}`);
  } else if (f.quantMethod === "gptq") {
    lines.push(`GPTQ block size: ${f.gptqBlockSize ?? 128}`);
    lines.push(`GPTQ group size: ${f.gptqGroupSize ?? 128}`);
    lines.push(`GPTQ desc_act: ${f.gptqDescAct ? "on" : "off"}`);
  } else if (f.quantMethod === "qat") {
    lines.push(`QAT precision: ${f.qatQuantPrecision?.toUpperCase() ?? "INT8"}`);
    lines.push(`QAT calibrate: ${f.qatCalibrateMethod ?? "percentile"}`);
    lines.push(`QAT steps: ${f.qatCalibrateSteps ?? 10}`);
  }
  return lines.join("\n");
}

const AI_PRESET_LABEL = "✨ Ask AI...";

const QUANT_PRESETS: QuantPreset[] = [
  {
    label: "Default INT4",
    description: "Post-training INT4 quantization — broadest compatibility",
    fields: { quantMethod: "ptq", quantPrecision: "int4" },
  },
  {
    label: "Default INT8",
    description: "Post-training INT8 — balanced size and accuracy",
    fields: { quantMethod: "ptq", quantPrecision: "int8" },
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
  {
    label: "QAT INT4 — Best Accuracy",
    description: "QAT INT4 with entropy calibration, 20 steps — highest quality",
    fields: {
      quantMethod: "qat",
      quantPrecision: "int4",
      qatQuantPrecision: "int4",
      qatCalibrateMethod: "entropy",
      qatCalibrateSteps: 20,
    },
  },
  {
    label: "QAT INT8 — Balanced",
    description: "QAT INT8 with percentile calibration, 10 steps — good accuracy/speed",
    fields: {
      quantMethod: "qat",
      quantPrecision: "int8",
      qatQuantPrecision: "int8",
      qatCalibrateMethod: "percentile",
      qatCalibrateSteps: 10,
    },
  },
];

// ── AI recommendation helper ───────────────────────────────────────

async function fetchAiQuantRecommendation(state: UIState): Promise<Partial<UIState["passes"]>> {
  const res = await fetch("/api/ai/recommend-quant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  const fields = (await res.json()) as Record<string, unknown>;

  // Ensure quantization is turned on
  const result: Partial<UIState["passes"]> = {
    quantization: true,
    quantPreset: "AI Recommendation",
    ...fields,
  };

  // Clean up any extraneous fields the AI might have returned
  delete (result as Record<string, unknown>).score;
  delete (result as Record<string, unknown>).level;
  delete (result as Record<string, unknown>).summary;
  delete (result as Record<string, unknown>).suggestions;

  return result;
}

// ── Main component ─────────────────────────────────────────────────

const SAVE_ACTION = "__save_custom__";
const DELETE_PREFIX = "__delete__:";

export function QuantizationInspector({ state, setState }: InspectorProps) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [customPresets, setCustomPresets] = useState<CustomQuantPreset[]>(() => loadCustomPresets());
  const [importError, setImportError] = useAutoClearError(4000);
  const {
    handleImport: handleImportPresets,
    importConfirm,
    setImportConfirm,
  } = useImportPresets<CustomQuantPreset>({
    customPresets,
    setError: setImportError,
    parseImport: importPresetsJSON,
  });
  const currentPreset = useMemo(() => getCurrentQuantPreset(state), [state]);
  const allowedQuantMethods = getAllowedQuantMethods(state.ihvProvider);
  const isGptq = state.passes.quantMethod === "gptq";
  const isAwq = state.passes.quantMethod === "awq";
  const isQat = state.passes.quantMethod === "qat";
  const isHqq = state.passes.quantMethod === "hqq";
  const isRtn = state.passes.quantMethod === "rtn";
  const isSpinQuant = state.passes.quantMethod === "spinquant";
  const isQuaRot = state.passes.quantMethod === "quarot";

  const refreshCustomPresets = useCallback(() => {
    setCustomPresets(loadCustomPresets());
  }, []);

  const handleApplyPreset = (presetLabel: string) => {
    // Handle delete action
    if (presetLabel.startsWith(DELETE_PREFIX)) {
      const label = presetLabel.slice(DELETE_PREFIX.length);
      deleteCustomPreset(label);
      refreshCustomPresets();
      return;
    }
    // Handle save action
    if (presetLabel === SAVE_ACTION) {
      handleSaveCustom();
      return;
    }
    // If it's the AI ask option, call the API
    if (presetLabel === AI_PRESET_LABEL) {
      handleAskAi();
      return;
    }
    // Check custom presets first
    const customPreset = customPresets.find((p) => p.label === presetLabel);
    if (customPreset) {
      setState({ passes: { ...state.passes, ...customPreset.fields, quantPreset: presetLabel } });
      return;
    }
    // Then check built-in presets
    const preset = QUANT_PRESETS.find((p) => p.label === presetLabel);
    if (!preset) return;
    setState({ passes: { ...state.passes, ...preset.fields, quantPreset: presetLabel } });
  };

  const handleSaveCustom = () => {
    const name = window.prompt("Name your custom quantization preset:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    // Collect the current quant-relevant fields
    const passes = state.passes;
    const fields: Partial<UIState["passes"]> = {
      quantMethod: passes.quantMethod,
      quantPrecision: passes.quantPrecision,
    };
    if (passes.quantMethod === "gptq") {
      fields.gptqBlockSize = passes.gptqBlockSize;
      fields.gptqGroupSize = passes.gptqGroupSize;
      fields.gptqDescAct = passes.gptqDescAct;
    } else if (passes.quantMethod === "awq") {
      fields.awqGroupSize = passes.awqGroupSize;
      fields.awqDampPercent = passes.awqDampPercent;
      fields.awqSym = passes.awqSym;
    } else if (passes.quantMethod === "qat") {
      fields.qatQuantPrecision = passes.qatQuantPrecision;
      fields.qatCalibrateMethod = passes.qatCalibrateMethod;
      fields.qatCalibrateSteps = passes.qatCalibrateSteps;
    } else if (passes.quantMethod === "hqq") {
      // OnnxHqqQuantization — no configurable fields exposed yet.
      // Precision is controlled by quantPrecision dropdown.
    }
    saveCustomPreset({
      label: trimmed,
      description: `Custom ${passes.quantMethod.toUpperCase()} ${passes.quantPrecision} config`,
      fields,
      createdAt: Date.now(),
    });
    refreshCustomPresets();
  };

  const { handleExport: handleExportPresets, isEmpty: exportEmpty } = useExportPresets<CustomQuantPreset>({
    presets: customPresets,
    serialize: exportPresetsJSON,
    filename: "quantization-presets.json",
  });
  const handleAskAi = async () => {
    setAiLoading(true);
    setAiError("");
    try {
      const fields = await fetchAiQuantRecommendation(state);
      setState({ passes: { ...state.passes, ...fields } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "AI recommendation failed.";
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  if (!state.passes.quantization) {
    return (
      <p className="text-sm text-slate-500 font-sans italic text-center py-4">
        Quantization is skipped — model stays in floating point (FP16/FP32).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Pass settings</p>

      {/* Presets dropdown */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-slate-400">Quick presets</Label>
          {aiLoading && (
            <span className="text-[11px] text-electric-blue flex items-center gap-1">
              <RefreshCw className="h-3 w-3 animate-spin" />
              AI thinking…
            </span>
          )}
        </div>
        <div className="flex gap-2">
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
            className="h-9 text-sm bg-slate-950 flex-1 min-w-0"
            disabled={aiLoading}
          >
            <option value="" disabled>
              Apply a profile…
            </option>
            <option value={AI_PRESET_LABEL} disabled={aiLoading}>
              ✨ Ask AI… — auto-configure based on model + hardware
            </option>
            <option disabled className="text-slate-700" value="">
              ─── presets ───
            </option>
            {QUANT_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.label} title={formatPresetTooltip(preset)}>
                {preset.label} — {preset.description}
              </option>
            ))}
            {customPresets.length > 0 && (
              <>
                <option disabled className="text-slate-700" value="">
                  ─── custom ───
                </option>
                {customPresets.map((p) => (
                  <option
                    key={p.label}
                    value={`${DELETE_PREFIX}${p.label}`}
                    className="text-rose-400/70"
                    title={formatPresetTooltip({
                      label: p.label,
                      description: p.description,
                      fields: p.fields,
                    })}
                  >
                    ✕ {p.label}
                  </option>
                ))}
              </>
            )}
            <option disabled className="text-slate-700" value="">
              ─── actions ───
            </option>
            <option value={SAVE_ACTION}>💾 Save current as preset…</option>
          </Select>
          <button
            type="button"
            onClick={handleSaveCustom}
            className="h-9 w-9 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-900 flex items-center justify-center text-slate-400 hover:text-electric-blue transition-colors shrink-0 cursor-pointer"
            title={formatPresetTooltip(currentPreset)}
            aria-label="Save current config as preset"
          >
            <Save className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleExportPresets}
            disabled={exportEmpty}
            className="h-9 w-9 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-900 flex items-center justify-center text-slate-400 hover:text-electric-blue transition-colors shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            title={exportEmpty ? "No custom presets to export" : "Export custom presets as JSON file"}
            aria-label="Export presets"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleImportPresets}
            className="h-9 w-9 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-900 flex items-center justify-center text-slate-400 hover:text-electric-blue transition-colors shrink-0 cursor-pointer"
            title="Import presets from JSON file"
            aria-label="Import presets"
          >
            <Upload className="h-4 w-4" />
          </button>
        </div>
        {importConfirm && (
          <ImportConfirmDialog<CustomQuantPreset>
            importedPresets={importConfirm.importedPresets}
            collisions={importConfirm.collisions}
            mergedPresets={importConfirm.mergedPresets}
            presetDetail={(p) => {
              const f = p.fields;
              return `${f.quantMethod?.toUpperCase() ?? "PTQ"} · ${f.quantPrecision?.toUpperCase() ?? "INT8"}`;
            }}
            onImport={(merged) => {
              replaceAllCustomPresets(merged);
              setCustomPresets(merged);
              setImportConfirm(null);
            }}
            onCancel={() => setImportConfirm(null)}
          />
        )}
        {importError && (
          <div className="flex items-start gap-1.5 text-[11px] text-amber-400 mt-1">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{importError}</span>
          </div>
        )}
        {aiError && (
          <div className="flex items-start gap-1.5 text-[11px] text-rose-400 mt-1">
            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{aiError}</span>
          </div>
        )}
      </div>

      <hr className="border-slate-800" />

      {/* Method & precision */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectRow
          id="quant-target-precision"
          label="Target precision"
          value={state.passes.quantPrecision}
          onChange={(v) =>
            setState({
              passes: { ...state.passes, quantPrecision: v as UIState["passes"]["quantPrecision"] },
            })
          }
        >
          <option value="int4">INT4 — maximum compression</option>
          <option value="int8">INT8 — balanced</option>
          <option value="fp16">FP16 — half precision</option>
        </SelectRow>
        <div className="space-y-1.5">
          <Label htmlFor="quant-method" className="text-sm text-slate-400">
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
            className="h-9 text-sm bg-slate-950"
          >
            {allowedQuantMethods.includes("ptq") && <option value="ptq">PTQ — post-training</option>}
            {allowedQuantMethods.includes("awq") && <option value="awq">AWQ — activation-aware</option>}
            {allowedQuantMethods.includes("gptq") && <option value="gptq">GPTQ — optimal int4</option>}
            {allowedQuantMethods.includes("qat") && (
              <option value="qat">QAT — quantization-aware training</option>
            )}
            {allowedQuantMethods.includes("hqq") && <option value="hqq">HQQ — half-quadratic</option>}
            {allowedQuantMethods.includes("rtn") && <option value="rtn">RTN — round-to-nearest</option>}
            {allowedQuantMethods.includes("spinquant") && (
              <option value="spinquant">SpinQuant — rotation-based</option>
            )}
            {allowedQuantMethods.includes("quarot") && (
              <option value="quarot">QuaRot — Hadamard rotation</option>
            )}
          </Select>
        </div>
      </div>

      {/* GPTQ advanced */}
      {isGptq && (
        <AdvancedDropdown title="GPTQ advanced settings">
          <SelectRow
            id="gptq-block-size"
            label="Block size"
            value={String(state.passes.gptqBlockSize)}
            onChange={(v) => setState({ passes: { ...state.passes, gptqBlockSize: Number(v) } })}
          >
            <option value="32">32 — fine-grained</option>
            <option value="64">64 — balanced</option>
            <option value="128">128 — default</option>
            <option value="256">256 — coarse</option>
          </SelectRow>
          <SelectRow
            id="gptq-group-size"
            label="Group size"
            value={String(state.passes.gptqGroupSize)}
            onChange={(v) => setState({ passes: { ...state.passes, gptqGroupSize: Number(v) } })}
          >
            <option value="32">32 — fine</option>
            <option value="64">64 — medium</option>
            <option value="128">128 — default</option>
          </SelectRow>
          <SwitchRow
            id="gptq-desc-act"
            label="Desc. act."
            checked={state.passes.gptqDescAct}
            onCheckedChange={(c) => setState({ passes: { ...state.passes, gptqDescAct: c } })}
            labelOn="On (slower, more accurate)"
            labelOff="Off (faster, less accurate)"
          />
        </AdvancedDropdown>
      )}

      {/* AWQ advanced */}
      {isAwq && (
        <AdvancedDropdown title="AWQ advanced settings">
          <SelectRow
            id="awq-group-size"
            label="Group size"
            value={String(state.passes.awqGroupSize)}
            onChange={(v) => setState({ passes: { ...state.passes, awqGroupSize: Number(v) } })}
          >
            <option value="32">32 — fine</option>
            <option value="64">64 — medium</option>
            <option value="128">128 — default</option>
          </SelectRow>
          <SelectRow
            id="awq-damp-percent"
            label="Damp %"
            value={String(state.passes.awqDampPercent)}
            onChange={(v) => setState({ passes: { ...state.passes, awqDampPercent: Number(v) } })}
          >
            <option value="0.001">0.001 — minimal</option>
            <option value="0.005">0.005 — slight</option>
            <option value="0.01">0.01 — default</option>
            <option value="0.05">0.05 — moderate</option>
          </SelectRow>
          <SwitchRow
            id="awq-sym"
            label="Symmetric"
            checked={state.passes.awqSym}
            onCheckedChange={(c) => setState({ passes: { ...state.passes, awqSym: c } })}
            labelOn="On (faster, zero-point 0)"
            labelOff="Off (per-channel zero-point)"
          />
        </AdvancedDropdown>
      )}

      {/* QAT advanced */}
      {isQat && (
        <AdvancedDropdown title="QAT advanced settings">
          <SelectRow
            id="qat-target-precision"
            label="Quant precision"
            value={state.passes.qatQuantPrecision}
            onChange={(v) =>
              setState({ passes: { ...state.passes, qatQuantPrecision: v as "int4" | "int8" } })
            }
          >
            <option value="int4">INT4 — maximum compression</option>
            <option value="int8">INT8 — balanced</option>
          </SelectRow>
          <SelectRow
            id="qat-calibrate-method"
            label="Calibrate method"
            value={state.passes.qatCalibrateMethod}
            onChange={(v) =>
              setState({
                passes: { ...state.passes, qatCalibrateMethod: v as "minmax" | "percentile" | "entropy" },
              })
            }
          >
            <option value="minmax">Min-Max — fastest</option>
            <option value="percentile">Percentile — outlier-robust</option>
            <option value="entropy">Entropy — best accuracy</option>
          </SelectRow>
          <SelectRow
            id="qat-calibrate-steps"
            label="Calibrate steps"
            value={String(state.passes.qatCalibrateSteps)}
            onChange={(v) => setState({ passes: { ...state.passes, qatCalibrateSteps: Number(v) } })}
          >
            <option value="5">5 — minimal</option>
            <option value="10">10 — default</option>
            <option value="20">20 — thorough</option>
            <option value="50">50 — exhaustive</option>
          </SelectRow>
        </AdvancedDropdown>
      )}

      {/* HQQ info (OnnxHqqQuantization) */}
      {isHqq && (
        <AdvancedDropdown title="HQQ advanced settings">
          <p className="text-xs text-slate-500 col-span-full -mt-2 mb-1">
            Uses OnnxHqqQuantization — half-quadratic quantization for ONNX MatMul weight-only 4-bit
            compression on any provider.
          </p>
        </AdvancedDropdown>
      )}

      {/* RTN info (OnnxBlockWiseRtnQuantization) */}
      {isRtn && (
        <AdvancedDropdown title="RTN settings">
          <p className="text-xs text-slate-500 col-span-full -mt-2 mb-1">
            Uses OnnxBlockWiseRtnQuantization — block-wise round-to-nearest for ONNX MatMul/Gather weight-only
            4/8-bit quantization. Fastest setup, no calibration needed.
          </p>
        </AdvancedDropdown>
      )}

      {/* SpinQuant info */}
      {isSpinQuant && (
        <AdvancedDropdown title="SpinQuant info">
          <p className="text-xs text-slate-500 col-span-full -mt-2 mb-1">
            Dedicated SpinQuant pass — learns orthogonal rotation matrices to eliminate outliers in
            weights/activations. Supports HuggingFace transformer PyTorch models only.
          </p>
        </AdvancedDropdown>
      )}

      {/* QuaRot info */}
      {isQuaRot && (
        <AdvancedDropdown title="QuaRot info">
          <p className="text-xs text-slate-500 col-span-full -mt-2 mb-1">
            Dedicated QuaRot pass — applies Hadamard-domain rotations to whiten weights. Supports HuggingFace
            transformer PyTorch models only.
          </p>
        </AdvancedDropdown>
      )}

      {/* Recipe diff overlay */}
      <RecipeDiffOverlay state={state} />
    </div>
  );
}
