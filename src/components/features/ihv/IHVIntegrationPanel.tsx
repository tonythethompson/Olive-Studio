import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui";
import { UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import {
  applyProviderConflictAutofixes,
  getProviderConflicts,
  prepareProviderChange,
} from "@/lib/pipelineValidation";
import { getSelectableProviders, isProviderDetectedLocally } from "@/lib/hardwareProbe";
import { useHardwareProbe, useRefreshHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { getProviderRuntimeKind } from "@/lib/providerRuntimeKind";
import {
  isPreMaxwellNvidiaBox,
} from "@/lib/cudaDeps";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import { HardwareCompatibilityMatrix } from "./HardwareCompatibilityMatrix";
import { HardwareProbeDisplay } from "./HardwareProbeDisplay";
import { HardwarePassCards } from "./HardwarePassCards";
import { PASS_VALIDATIONS as validations } from "./hardwarePassCompatibility";
import {
  type HardwareProviderCardProps,
} from "@/components/features/ihv/HardwareProviderCard";
import { useOpenVinoInstall } from "@/components/features/ihv/useOpenVinoInstall";
import { useQnnInstall } from "@/components/features/ihv/useQnnInstall";
import { useDirectMlInstall } from "@/components/features/ihv/useDirectMlInstall";
import { runNdjsonInstall } from "@/lib/ndjsonInstall";
import {
  AlertTriangle,
  ShieldAlert,
  Wand2,
  Activity,
  Search,
  Table,
  List,
} from "lucide-react";
import { ProviderCardGrid } from "./ProviderCardGrid";
import { MemoryOffloadControls } from "./MemoryOffloadControls";
import { QnnAbiCoercionNotice } from "./QnnAbiCoercionNotice";

export { getProviderConflicts };

const providers = PROVIDER_CATALOG;

/**
 * Configures the pipeline's hardware execution provider and optimization passes.
 *
 * Displays local hardware capabilities, provider compatibility, installation options, and
 * provider-specific settings while allowing supported optimization passes to be enabled or disabled.
 *
 * @param propState - Optional pipeline state to display and modify (`state`).
 * @param propSetState - Optional updater for applying pipeline state changes (`setState`).
 */
export function IHVIntegrationPanel({
  state: propState,
  setState: propSetState,
}: {
  state?: UIState;
  setState?: (s: Partial<UIState>) => void;
} = {}) {
  const storeState = usePipelineState();
  const state = propState ?? storeState.state;
  const setState = propSetState ?? storeState.setState;
  const [passSearch, setPassSearch] = useState("");
  // Cards reduce cognitive load and improve touch targets; make them the default.
  const [activeTab, setActiveTab] = useState<"matrix" | "cards">("cards");
  const [selectedCategory, setSelectedCategory] = useState<
    "All" | "Conversion" | "Quantization" | "Compression" | "PEFT"
  >("All");
  const hardwareProbeQuery = useHardwareProbe();
  const hardwareProbe = hardwareProbeQuery.data ?? null;
  const refreshHardwareProbe = useRefreshHardwareProbe();
  const [refreshingProbe, setRefreshingProbe] = useState(false);
  const [refreshProbeError, setRefreshProbeError] = useState<string | null>(null);
  const probeLoading = hardwareProbeQuery.isLoading || refreshingProbe;
  const probeError =
    refreshProbeError ??
    (hardwareProbeQuery.error instanceof Error ? hardwareProbeQuery.error.message : null);
  const [installingTrtRtx, setInstallingTrtRtx] = useState(false);
  const [installTrtRtxError, setInstallTrtRtxError] = useState<string | null>(null);
  const [installTrtRtxLog, setInstallTrtRtxLog] = useState<string[]>([]);
  const [installingTrt, setInstallingTrt] = useState(false);
  const [installTrtError, setInstallTrtError] = useState<string | null>(null);
  const [installTrtLog, setInstallTrtLog] = useState<string[]>([]);
  const [installingOrtGpu, setInstallingOrtGpu] = useState(false);
  const [installOrtGpuError, setInstallOrtGpuError] = useState<string | null>(null);
  const [installOrtGpuLog, setInstallOrtGpuLog] = useState<string[]>([]);

  const hasAutoAppliedRef = useRef(false);
  const latestStateRef = useRef(state);
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  // Auto-apply recommended provider the first time a probe result lands,
  // whether from the shared query's own mount fetch or a manual refresh.
  useEffect(() => {
    if (hasAutoAppliedRef.current || !hardwareProbe?.recommendedProvider) return;
    hasAutoAppliedRef.current = true;
    setState(
      prepareProviderChange(latestStateRef.current, hardwareProbe.recommendedProvider, hardwareProbe) ?? {
        ihvProvider: hardwareProbe.recommendedProvider,
      },
    );
  }, [hardwareProbe, setState]);

  // ─── QNN ABI Coercion Notification ───────────────────────────────────────────
  // Track which passes were coerced off by QNN ABI selection so we can show
  // a transient inline notification per requirement 9.7.
  const [qnnAbiCoercedPasses, setQnnAbiCoercedPasses] = useState<string[]>([]);
  const prevProviderRef = useRef(state.ihvProvider);
  const prevPassesRef = useRef(state.passes);

  useEffect(() => {
    const prevProvider = prevProviderRef.current;
    const prevPasses = prevPassesRef.current;
    prevProviderRef.current = state.ihvProvider;
    prevPassesRef.current = state.passes;

    // Only fire when switching TO QnnAbiExecutionProvider from a different provider
    if (state.ihvProvider !== "QnnAbiExecutionProvider" || prevProvider === "QnnAbiExecutionProvider") {
      // Clear any stale notice when leaving QNN so a later switch back without
      // new coercions does not resurface passes from the previous QNN session.
      if (state.ihvProvider !== "QnnAbiExecutionProvider" && prevProvider === "QnnAbiExecutionProvider") {
        setQnnAbiCoercedPasses([]);
      }
      return;
    }

    // Determine which passes were coerced off
    const coerced: string[] = [];
    if (prevPasses.conversion && !state.passes.conversion) coerced.push("conversion");
    if (prevPasses.quantization && !state.passes.quantization) coerced.push("quantization");
    if (prevPasses.onnxDiscrepancyCheck && !state.passes.onnxDiscrepancyCheck) coerced.push("onnxDiscrepancyCheck");

    if (coerced.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: track coerced passes on provider switch
      setQnnAbiCoercedPasses(coerced);
    }
  }, [state.ihvProvider, state.passes]);

  const dismissQnnAbiNotice = useCallback(() => {
    setQnnAbiCoercedPasses([]);
  }, []);

  // Forces a fresh probe, bypassing the server-side cache. Passed to the
  // install hooks (onProbeRefresh) and the manual rescan button; the initial
  // mount-time probe is handled by useHardwareProbe itself.
  const runHardwareProbe = useCallback(
    async (refresh = false) => {
      if (!refresh) return;
      setRefreshingProbe(true);
      setRefreshProbeError(null);
      try {
        await refreshHardwareProbe();
      } catch (err) {
        setRefreshProbeError(err instanceof Error ? err.message : "Hardware probe failed.");
      } finally {
        setRefreshingProbe(false);
      }
    },
    [refreshHardwareProbe],
  );

  // Shared mutex across hardware installs (families differ, but pip UX is serialized).
  const openvinoInstall = useOpenVinoInstall({
    onProbeRefresh: runHardwareProbe,
    isInstallBusy: installingTrt || installingTrtRtx || installingOrtGpu,
  });

  const qnnInstall = useQnnInstall({
    onProbeRefresh: runHardwareProbe,
    isInstallBusy:
      installingTrt ||
      installingTrtRtx ||
      installingOrtGpu ||
      openvinoInstall.state.installing,
  });

  const directMlInstall = useDirectMlInstall({
    onProbeRefresh: runHardwareProbe,
    isInstallBusy:
      installingTrt ||
      installingTrtRtx ||
      installingOrtGpu ||
      openvinoInstall.state.installing ||
      qnnInstall.state.installing ||
      qnnInstall.state.testing,
  });

  const trtRtxNeedsInstall =
    Boolean(hardwareProbe?.nvidia?.gpus.length) && hardwareProbe?.tensorRtRtx?.loadable !== true;
  const trtNeedsInstall =
    Boolean(hardwareProbe?.nvidia?.gpus.length) && hardwareProbe?.tensorrt?.loadable !== true;
  const openvinoNeedsInstall =
    Boolean(hardwareProbe) &&
    isProviderDetectedLocally("OpenVINOExecutionProvider", hardwareProbe) &&
    hardwareProbe?.openvino?.loadable !== true;
  // CUDA install / toolkit-link gating (from PR #106).
  const probedNvidiaGpus = hardwareProbe?.nvidia?.gpus;
  const nvidiaGpus = useMemo(() => probedNvidiaGpus ?? [], [probedNvidiaGpus]);
  const isPreMaxwellBox = isPreMaxwellNvidiaBox(nvidiaGpus);
  const cudaEpInVenv = hardwareProbe?.cuda?.loadable === true;
  const cudaNeedsOrtGpuInstall = nvidiaGpus.length > 0 && !isPreMaxwellBox && !cudaEpInVenv;
  const cudaToolkitMissing = hardwareProbe?.nvidia?.cudaToolkit?.available === false;
  const cudaToolkitMissingAndEpWorks =
    nvidiaGpus.length > 0 && !isPreMaxwellBox && cudaEpInVenv && cudaToolkitMissing;

  // Shared mutex across hardware installs (families differ, but pip UX is serialized).
  const hardwareInstallBusy =
    installingTrt ||
    installingTrtRtx ||
    installingOrtGpu ||
    openvinoInstall.state.installing ||
    qnnInstall.state.installing ||
    qnnInstall.state.testing ||
    directMlInstall.state.installing;

  const handleInstallTensorRtRtx = useCallback(async () => {
    if (hardwareInstallBusy) return;
    setInstallingTrtRtx(true);
    setInstallTrtRtxError(null);
    setInstallTrtRtxLog([]);
    try {
      await runNdjsonInstall("/api/env/install-tensorrt-rtx", setInstallTrtRtxLog);
      await runHardwareProbe(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstallTrtRtxError(
        msg === "Failed to fetch"
          ? "Could not reach the Olive Studio server (or the connection dropped during install). Keep pnpm dev running, then retry. First install also creates .venv and can take several minutes."
          : msg,
      );
    } finally {
      setInstallingTrtRtx(false);
    }
  }, [hardwareInstallBusy, runHardwareProbe]);

  const handleInstallTensorRt = useCallback(async () => {
    if (hardwareInstallBusy) return;
    setInstallingTrt(true);
    setInstallTrtError(null);
    setInstallTrtLog([]);
    try {
      await runNdjsonInstall("/api/env/install-tensorrt", setInstallTrtLog);
      await runHardwareProbe(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstallTrtError(
        msg === "Failed to fetch"
          ? "Could not reach the Olive Studio server (or the connection dropped during install). Keep pnpm dev running, then retry. Full TensorRT is a large download."
          : msg,
      );
    } finally {
      setInstallingTrt(false);
    }
  }, [hardwareInstallBusy, runHardwareProbe]);

  const handleInstallOrtGpu = useCallback(async () => {
    if (hardwareInstallBusy) return;
    setInstallingOrtGpu(true);
    setInstallOrtGpuError(null);
    setInstallOrtGpuLog([]);
    try {
      await runNdjsonInstall("/api/env/install-onnxruntime-gpu", setInstallOrtGpuLog);
      await runHardwareProbe(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstallOrtGpuError(
        msg === "Failed to fetch"
          ? "Could not reach the Olive Studio server (or the connection dropped during install). Keep pnpm dev running, then retry."
          : msg,
      );
    } finally {
      setInstallingOrtGpu(false);
    }
  }, [hardwareInstallBusy, runHardwareProbe]);

  const filteredValidations = validations.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(passSearch.toLowerCase()) ||
      v.description.toLowerCase().includes(passSearch.toLowerCase()) ||
      v.category.toLowerCase().includes(passSearch.toLowerCase());
    const matchesCategory = selectedCategory === "All" || v.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Real-time conflicts of the selected hardware provider
  const selectedConflicts = getProviderConflicts(state.ihvProvider, state.passes);
  const selectableProviders = useMemo(() => providers, []);
  const localAccelerators = useMemo(
    () => selectableProviders.filter((p) => getProviderRuntimeKind(p.id) === "local"),
    [selectableProviders],
  );
  const exportAndPlatformTargets = useMemo(
    () => selectableProviders.filter((p) => getProviderRuntimeKind(p.id) !== "local"),
    [selectableProviders],
  );
  const detectedProviders = useMemo(() => getSelectableProviders(hardwareProbe), [hardwareProbe]);
  const locallyDetectedCount = useMemo(
    () => selectableProviders.filter((p) => isProviderDetectedLocally(p.id, hardwareProbe)).length,
    [selectableProviders, hardwareProbe],
  );
  const hasSelectedCritical = selectedConflicts.some((c) => c.severity === "critical");

  const providerCardProps: Omit<HardwareProviderCardProps, "provider"> = useMemo(
    () => ({
      state,
      setState,
      hardwareProbe,
      probeLoading,
      detectedProviders,
      trtRtxNeedsInstall,
      trtNeedsInstall,
      openvinoNeedsInstall,
      hardwareInstallBusy,
      installingTrtRtx,
      installTrtRtxError,
      installTrtRtxLog,
      onInstallTensorRtRtx: () => void handleInstallTensorRtRtx(),
      installingTrt,
      installTrtError,
      installTrtLog,
      onInstallTensorRt: () => void handleInstallTensorRt(),
      openvinoInstall,
      qnnInstall,
      directMlInstall,
      isPreMaxwellBox,
      cudaNeedsOrtGpuInstall,
      cudaToolkitMissingAndEpWorks,
      cudaToolkitMissing,
      cudaEpInVenv,
      nvidiaGpus,
      installingOrtGpu,
      installOrtGpuError,
      installOrtGpuLog,
      onInstallOrtGpu: () => void handleInstallOrtGpu(),
    }),
    [
      state,
      setState,
      hardwareProbe,
      probeLoading,
      detectedProviders,
      trtRtxNeedsInstall,
      trtNeedsInstall,
      openvinoNeedsInstall,
      hardwareInstallBusy,
      installingTrtRtx,
      installTrtRtxError,
      installTrtRtxLog,
      handleInstallTensorRtRtx,
      installingTrt,
      installTrtError,
      installTrtLog,
      handleInstallTensorRt,
      openvinoInstall,
      qnnInstall,
      directMlInstall,
      isPreMaxwellBox,
      cudaNeedsOrtGpuInstall,
      cudaToolkitMissingAndEpWorks,
      cudaToolkitMissing,
      cudaEpInVenv,
      nvidiaGpus,
      installingOrtGpu,
      installOrtGpuError,
      installOrtGpuLog,
      handleInstallOrtGpu,
    ],
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 min-w-0 max-w-full">
      <Card>
        <CardHeader
          title="Hardware acceleration"
          description="Select execution provider and accelerator target. Olive optimizes graphs for the chosen backend."
        />
        <CardContent>
          {/* Live hardware probe from this machine */}
          <HardwareProbeDisplay
            state={state}
            setState={setState}
            hardwareProbe={hardwareProbe}
            probeLoading={probeLoading}
            probeError={probeError}
            onRescan={() => void runHardwareProbe(true)}
          />

          <VramEstimateBanner
            state={state}
            setState={setState}
            hardwareProbe={hardwareProbe}
            className="mb-6"
          />

          {/* Hardware Validation Guard Alert Summary Banner */}
          {selectedConflicts.length > 0 && (
            <div
              className={`mb-6 rounded-xl border p-4.5 animate-in slide-in-from-top-2 duration-300 flex flex-col gap-3.5 ${hasSelectedCritical
                ? "bg-rose-950/15 border-rose-500/30 shadow-[0_2px_12px_rgba(244,63,94,0.03)]"
                : "bg-amber-955/15 border-amber-500/30 shadow-[0_2px_12px_rgba(245,158,11,0.03)]"
                }`}
            >
              <div className="flex items-start md:items-center justify-between border-b border-slate-800/80 pb-3 flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded shrink-0 ${hasSelectedCritical ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-500"
                      }`}
                  >
                    {hasSelectedCritical ? (
                      <ShieldAlert className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <h4
                      className={`text-sm font-medium ${hasSelectedCritical ? "text-rose-300" : "text-amber-400"}`}
                    >
                      Pipeline conflict ({selectedConflicts.length})
                    </h4>
                    <p className="text-xs text-slate-400 leading-normal">
                      The execution passes currently configured in your recipe are incompatible with the
                      selected
                      <span className="text-white font-semibold">
                        {" "}
                        {providers.find((p) => p.id === state.ihvProvider)?.name}
                      </span>
                      .
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setState({
                      passes: applyProviderConflictAutofixes(state.ihvProvider, state.passes),
                    });
                  }}
                  className={`text-sm px-3 py-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 hover:text-white ${hasSelectedCritical
                    ? "border-rose-500/30 bg-rose-950/20 text-rose-400 hover:bg-rose-500/20"
                    : "border-amber-500/30 bg-amber-950/20 text-amber-400 hover:bg-amber-500/20"
                    }`}
                >
                  <Wand2 className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 break-words leading-tight">Auto-Fix Active Config Conflicts</span>
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 mb-3">
            {probeLoading
              ? "Detecting local execution providers…"
              : `Showing all ${selectableProviders.length} providers. ${locallyDetectedCount} detected locally. Undetected targets are still selectable for cross-compile / remote builds.`}
          </p>

          <div className="grid gap-4 mt-2 min-w-0 w-full">
            {qnnAbiCoercedPasses.length > 0 && (
              <QnnAbiCoercionNotice
                coercedPasses={qnnAbiCoercedPasses}
                onDismiss={dismissQnnAbiNotice}
              />
            )}
            <ProviderCardGrid
              probeLoading={probeLoading}
              localAccelerators={localAccelerators}
              exportAndPlatformTargets={exportAndPlatformTargets}
              providerCardProps={providerCardProps}
            />
          </div>

          <MemoryOffloadControls state={state} setState={setState} hardwareProbe={hardwareProbe} />

          {/* Interactive Optimization Passes Cross-Referencing Matrix */}
          <div className="mt-10 pt-8 border-t border-slate-800">
            {/* Header, Search Filter, and View Toggles */}
            <div className="flex flex-col gap-6 mb-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Activity className="h-4.5 w-4.5 text-electric-blue shrink-0" />
                    Pass ↔ Provider Compatibility Matrix
                  </h3>
                  <p className="text-sm text-slate-500 mt-1 max-w-2xl">
                    Rule-based pass compatibility for each execution provider. Green cells mean the pass is
                    allowed on that backend; hardware availability is shown separately in the probe banner and
                    column headers.
                  </p>
                </div>

                {/* View Switch Segmented Control */}
                <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg self-start min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab("matrix")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap cursor-pointer transition-all ${activeTab === "matrix"
                      ? "bg-electric-blue text-white font-bold"
                      : "text-slate-400 hover:text-slate-205"
                      }`}
                  >
                    <Table className="h-3.5 w-3.5" />
                    Matrix View
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("cards")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap cursor-pointer transition-all ${activeTab === "cards"
                      ? "bg-electric-blue text-white font-bold"
                      : "text-slate-400 hover:text-slate-205"
                      }`}
                  >
                    <List className="h-3.5 w-3.5" />
                    Interactive Cards
                  </button>
                </div>
              </div>

              {/* Filtering Suite */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-900/35 p-4 rounded-xl border border-slate-800/60">
                {/* Text Search */}
                <div className="md:col-span-5 relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search compiler passes..."
                    value={passSearch}
                    onChange={(e) => setPassSearch(e.target.value)}
                    className="w-full h-9 bg-slate-950 border border-slate-800/80 rounded-lg pl-9 pr-4 text-sm font-medium text-slate-200 placeholder-slate-500 outline-none focus:border-electric-blue/50 focus:ring-1 focus:ring-electric-blue/30 transition-all font-sans"
                  />
                  {passSearch && (
                    <button
                      type="button"
                      onClick={() => setPassSearch("")}
                      className="absolute right-2.5 top-2 text-[11px] bg-slate-850 hover:bg-slate-700 text-slate-400 p-1 px-1.5 rounded cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Categories badges filter */}
                <div className="md:col-span-7 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-mono text-slate-500 uppercase font-black tracking-wider mr-1">
                    Filter:
                  </span>
                  {(["All", "Conversion", "Quantization", "Compression", "PEFT"] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1 rounded-full text-[10.5px] font-semibold tracking-tight transition-all cursor-pointer ${selectedCategory === cat
                        ? "bg-electric-blue/15 border-electric-blue/40 text-electric-blue font-bold border"
                        : "bg-slate-950 hover:bg-slate-900 border border-slate-805 text-slate-400"
                        }`}
                    >
                      {cat === "All" ? "All Passes" : cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Empty state if search returns nothing */}
            {filteredValidations.length === 0 ? (
              <div className="text-center py-12 rounded-xl border border-dashed border-slate-800/80 bg-slate-900/5 mt-2 animate-in fade-in">
                <ShieldAlert className="h-10 w-10 text-slate-500 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-350">
                  No optimization passes match your filter criteria
                </p>
                <p className="text-sm text-slate-505 mt-1 max-w-md mx-auto">
                  Try clearing your search query or choosing "All Passes" to display the full compatibility
                  matrix.
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setPassSearch("");
                      setSelectedCategory("All");
                    }}
                    className="text-sm bg-electric-blue hover:bg-electric-blue-dark text-white font-bold p-2 px-4 rounded-lg cursor-pointer"
                  >
                    Reset Active Filters
                  </button>
                </div>
              </div>
            ) : activeTab === "matrix" ? (
              <HardwareCompatibilityMatrix
                selectableProviders={selectableProviders}
                state={state}
                hardwareProbe={hardwareProbe}
                probeLoading={probeLoading}
                filteredValidations={filteredValidations}
                detectedProviders={detectedProviders}
                setState={setState}
              />
            ) : (
              <HardwarePassCards
                filteredValidations={filteredValidations}
                state={state}
                setState={setState}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
