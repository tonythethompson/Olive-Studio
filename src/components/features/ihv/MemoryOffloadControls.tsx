/**
 * MemoryOffloadControls — Hybrid memory offload toggle and CUDA version override.
 * Extracted from IHVIntegrationPanel (Task 6).
 */
import { Select, Label } from "@/components/ui";
import { Switch } from "@/components/ui/Switch";
import type { IHVProvider, UIState } from "@/types";
import { isMemoryOffloadAvailable, hasHuggingFaceModel } from "@/lib/memoryOffload";
import { isGpuProvider } from "@/lib/vramEstimate";
import { prepareProviderChange } from "@/lib/pipelineValidation";
import {
  OPEN_VINO_TARGET_DEVICES,
  isOpenVinoTargetAvailable,
  type OpenVinoTargetDevice,
} from "@/lib/openvinoDeps";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import { HardDrive, Settings2 } from "lucide-react";

const providers = PROVIDER_CATALOG;

export interface MemoryOffloadControlsProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  hardwareProbe: HardwareProbeResult | null;
}

export function MemoryOffloadControls({
  state,
  setState,
  hardwareProbe,
}: MemoryOffloadControlsProps) {
  return (
    <>
      {/* Hybrid offload — visible for Hugging Face models */}
      {hasHuggingFaceModel(state) && (
        <div className="mt-4 p-4 rounded-xl border border-slate-800/60 bg-slate-900/30">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-200 flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-electric-blue" />
                Hybrid memory offload
              </p>
              <p className="text-sm text-slate-500 leading-relaxed max-w-xl">
                Spreads <span className="font-mono text-slate-400">{state.hfModelId}</span> across GPU
                VRAM and system RAM during optimization (
                <code className="text-slate-400">device_map: auto</code>).
              </p>
              {!isMemoryOffloadAvailable(state) && (
                <p className="text-xs text-amber-500/90 leading-relaxed">
                  Select <strong className="font-semibold">NVIDIA CUDA</strong>,{" "}
                  <strong className="font-semibold">TensorRT RTX</strong>,{" "}
                  <strong className="font-semibold">TensorRT</strong>, or{" "}
                  <strong className="font-semibold">AMD ROCm</strong> above to enable this toggle.
                  {hardwareProbe &&
                    isGpuProvider(hardwareProbe.recommendedProvider) &&
                    !isGpuProvider(state.ihvProvider) && (
                      <button
                        type="button"
                        onClick={() =>
                          setState(
                            prepareProviderChange(state, hardwareProbe.recommendedProvider, hardwareProbe) ?? {
                              ihvProvider: hardwareProbe.recommendedProvider,
                            },
                          )
                        }
                        className="ml-2 text-electric-blue hover:text-white cursor-pointer underline underline-offset-2"
                      >
                        Switch to {providers.find((p) => p.id === hardwareProbe.recommendedProvider)?.name}
                      </button>
                    )}
                </p>
              )}
            </div>
            <Switch
              aria-label="Hybrid memory offload"
              disabled={!isMemoryOffloadAvailable(state)}
              checked={isMemoryOffloadAvailable(state) && state.memoryOffload === "auto"}
              onCheckedChange={(checked) => setState({ memoryOffload: checked ? "auto" : "gpu_only" })}
            />
          </div>
        </div>
      )}

      {state.modelSource !== "huggingface" && isGpuProvider(state.ihvProvider) && (
        <p className="mt-4 text-xs text-slate-600 px-1">
          Hybrid memory offload needs a Hugging Face model in step 01 (Local/Azure sources are not supported).
        </p>
      )}

      {/* CUDA Version Override — only for GPU providers */}
      {(
        ["CUDAExecutionProvider", "NvTensorRTRTXExecutionProvider", "TensorrtExecutionProvider", "ROCMExecutionProvider"] as IHVProvider[]
      ).includes(state.ihvProvider) && (
          <div className="mt-4">
            <div className="p-4 rounded-xl border border-slate-800/60 bg-slate-900/30">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-slate-200">PyTorch CUDA Version</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {hardwareProbe?.nvidia?.cudaTag ? (
                      <>
                        Probed: CUDA {hardwareProbe.nvidia.cudaVersion} (
                        <code className="text-emerald-400 bg-slate-800 px-1 py-0.5 rounded">{hardwareProbe.nvidia.cudaTag}</code>
                        ) via nvidia-smi. Override if wrong.
                      </>
                    ) : (
                      <>
                        Auto-detect reads <code className="text-slate-400 bg-slate-800 px-1 py-0.5 rounded">nvidia-smi</code> at execute time. Override if wrong toolkit version is picked.
                      </>
                    )}
                  </p>
                </div>
                <select
                  id="cuda-version-override"
                  aria-label="PyTorch CUDA Version"
                  value={state.cudaVersion ?? "auto"}
                  onChange={(e) => setState({ cudaVersion: e.target.value as UIState["cudaVersion"] })}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-electric-blue shrink-0 cursor-pointer"
                >
                  <option value="auto">Auto-detect</option>
                  <option value="cpu">CPU Only</option>
                  <option value="cu118">CUDA 11.8</option>
                  <option value="cu121">CUDA 12.1</option>
                  <option value="cu124">CUDA 12.4</option>
                  <option value="cu126">CUDA 12.6</option>
                  <option value="cu128">CUDA 12.8</option>
                  <option value="cu130">CUDA 13.0 (driver only — no package pins yet)</option>
                  <option value="cu132">CUDA 13.2 (driver only — no package pins yet)</option>
                </select>
              </div>
            </div>
          </div>
        )}

      {/* Vendor Specific Flags */}
      <div className="mt-8 pt-6 border-t border-slate-800">
        <h3 className="text-sm font-medium mb-4 text-slate-300 flex items-center gap-2">
          <Settings2 className="w-4 h-4" /> Target Specific Flags
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {state.ihvProvider === "TensorrtExecutionProvider" ||
            state.ihvProvider === "CUDAExecutionProvider" ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="flag-use-fp16">Use fp16</Label>
                  <p className="text-sm text-slate-500">Enable Tensor Core math. Always on for this target.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-500">Always on</span>
                  <Switch id="flag-use-fp16" aria-label="Use fp16 (always on)" checked disabled />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="flag-trt-graph-opts">Enable TensorRT Graph Optimizations</Label>
                  <p className="text-sm text-slate-500">Build TensorRT engines dynamically. Always on for this target.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-500">Always on</span>
                  <Switch id="flag-trt-graph-opts" aria-label="Enable TensorRT Graph Optimizations (always on)" checked disabled />
                </div>
              </div>
            </>
          ) : state.ihvProvider === "OpenVINOExecutionProvider" ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="openvino-target-device">Target Device</Label>
                  <p className="text-sm text-slate-500">OpenVINO silicon target (CPU, Intel GPU, or NPU)</p>
                </div>
                <Select
                  id="openvino-target-device"
                  aria-label="Target Device"
                  className="w-full max-w-[150px]"
                  value={state.openvinoTargetDevice}
                  onChange={(e) => {
                    const next = e.target.value as OpenVinoTargetDevice;
                    if (OPEN_VINO_TARGET_DEVICES.includes(next)) {
                      setState({ openvinoTargetDevice: next });
                    }
                  }}
                >
                  {OPEN_VINO_TARGET_DEVICES.map((device) => {
                    const available = isOpenVinoTargetAvailable(device, hardwareProbe?.openvino?.devices);
                    return (
                      <option key={device} value={device} disabled={!available && Boolean(hardwareProbe)}>
                        {device}{!available && hardwareProbe ? " (not detected)" : ""}
                      </option>
                    );
                  })}
                </Select>
              </div>
            </>
          ) : (
            <div className="col-span-2 text-sm text-slate-500 py-2">
              No advanced configuration required for the standard execution provider.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
