/**
 * ProviderCardGrid — Provider card grid with local accelerators and export/platform sections.
 * Extracted from IHVIntegrationPanel (Task 6).
 */
import { useState, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { HardwareProviderCard, type HardwareProviderCardProps } from "./HardwareProviderCard";
import { ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { isProviderDetectedLocally } from "@/lib/hardwareProbe";
import type { ProviderCatalogEntry } from "@/lib/providerCatalog";

export interface ProviderCardGridProps {
  probeLoading: boolean;
  localAccelerators: ProviderCatalogEntry[];
  exportAndPlatformTargets: ProviderCatalogEntry[];
  providerCardProps: Omit<HardwareProviderCardProps, "provider">;
}

/**
 * Splits a list of providers into ungrouped entries and grouped sections (by `group` field).
 * Preserves original order: grouped entries appear in the position of the first member seen.
 */
function partitionByGroup(providers: ProviderCatalogEntry[]): {
  ungrouped: ProviderCatalogEntry[];
  groups: { heading: string; entries: ProviderCatalogEntry[] }[];
  /** Interleaved render order: `{ type: "entry", entry }` or `{ type: "group", heading, entries }` */
  renderOrder: (
    | { type: "entry"; entry: ProviderCatalogEntry }
    | { type: "group"; heading: string; entries: ProviderCatalogEntry[] }
  )[];
} {
  const ungrouped: ProviderCatalogEntry[] = [];
  const groupMap = new Map<string, ProviderCatalogEntry[]>();
  const renderOrder: (
    | { type: "entry"; entry: ProviderCatalogEntry }
    | { type: "group"; heading: string; entries: ProviderCatalogEntry[] }
  )[] = [];
  const groupInserted = new Set<string>();

  for (const p of providers) {
    if (p.group) {
      if (!groupMap.has(p.group)) {
        groupMap.set(p.group, []);
      }
      groupMap.get(p.group)!.push(p);
      // Insert the group placeholder at the position of the first member
      if (!groupInserted.has(p.group)) {
        groupInserted.add(p.group);
        renderOrder.push({ type: "group", heading: p.group, entries: groupMap.get(p.group)! });
      }
    } else {
      ungrouped.push(p);
      renderOrder.push({ type: "entry", entry: p });
    }
  }

  const groups = [...groupMap.entries()].map(([heading, entries]) => ({ heading, entries }));
  return { ungrouped, groups, renderOrder };
}

export function ProviderCardGrid({
  probeLoading,
  localAccelerators,
  exportAndPlatformTargets,
  providerCardProps,
}: ProviderCardGridProps) {
  // Export/platform targets (QNN, WebGPU, CoreML, NNAPI, TFLite, WASM, ...) are rarely
  // what someone came here to pick — they're deploy targets for a different runtime, not
  // candidates on this machine. Keep them out of the way unless the active selection is
  // one of them, or the user asks to see them.
  const selectedIsExportTarget = exportAndPlatformTargets.some(
    (p) => p.id === providerCardProps.state.ihvProvider,
  );
  const [showExportTargets, setShowExportTargets] = useState(selectedIsExportTarget);
  const [wasExportTarget, setWasExportTarget] = useState(selectedIsExportTarget);
  if (wasExportTarget !== selectedIsExportTarget) {
    setWasExportTarget(selectedIsExportTarget);
    setShowExportTargets(selectedIsExportTarget);
  }

  // Within local accelerators, cards for hardware not actually detected on this machine
  // (e.g. CoreML on a Windows box) are rarely the pick — collapse them the same way
  // export/platform targets collapse, unless the active selection is one of them.
  // However, if probe is still loading or failed (null), show all locals together since we
  // can't reliably distinguish detected from undetected without probe results.
  const { detectedLocal, undetectedLocal } = useMemo(() => {
    const hardwareProbe = providerCardProps.hardwareProbe;
    const detected: ProviderCatalogEntry[] = [];
    const undetected: ProviderCatalogEntry[] = [];

    // Only split if probe data is available; otherwise show all together since we can't distinguish
    // detected from undetected without probe results. Splitting would incorrectly hide providers when
    // probe fails (e.g., CPU is always available as fallback, but other providers appear undetected).
    if (!hardwareProbe && !probeLoading) {
      return { detectedLocal: localAccelerators, undetectedLocal: [] };
    }

    for (const p of localAccelerators) {
      if (isProviderDetectedLocally(p.id, hardwareProbe)) detected.push(p);
      else undetected.push(p);
    }
    return { detectedLocal: detected, undetectedLocal: undetected };
  }, [localAccelerators, providerCardProps.hardwareProbe, probeLoading]);

  // Partition detected locals into grouped sections (e.g. "Qualcomm Snapdragon") and ungrouped cards.
  const detectedRenderOrder = useMemo(() => partitionByGroup(detectedLocal).renderOrder, [detectedLocal]);
  const undetectedRenderOrder = useMemo(() => partitionByGroup(undetectedLocal).renderOrder, [undetectedLocal]);

  const selectedIsUndetectedLocal = undetectedLocal.some(
    (p) => p.id === providerCardProps.state.ihvProvider,
  );
  const [showUndetectedLocal, setShowUndetectedLocal] = useState(selectedIsUndetectedLocal);
  const [wasUndetectedLocal, setWasUndetectedLocal] = useState(selectedIsUndetectedLocal);
  if (wasUndetectedLocal !== selectedIsUndetectedLocal) {
    setWasUndetectedLocal(selectedIsUndetectedLocal);
    setShowUndetectedLocal(selectedIsUndetectedLocal);
  }

  if (probeLoading) {
    return (
      <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
        <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-600" />
        Probing NVIDIA, AMD, Intel, and CPU runtimes…
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        <div className="space-y-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Local accelerators
          </p>
          <div className="grid gap-4 min-w-0 w-full" data-tour="hardware-providers">
            {detectedRenderOrder.map((item) =>
              item.type === "entry" ? (
                <HardwareProviderCard key={item.entry.id} provider={item.entry} {...providerCardProps} />
              ) : (
                <div key={`group-${item.heading}`} className="space-y-3">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-800/60 pb-1.5">
                    {item.heading}
                  </p>
                  <div className="grid gap-4 min-w-0 w-full">
                    {item.entries.map((p) => (
                      <HardwareProviderCard key={p.id} provider={p} {...providerCardProps} />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
          {undetectedLocal.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowUndetectedLocal((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left cursor-pointer group"
                aria-expanded={showUndetectedLocal}
              >
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 group-hover:text-slate-400">
                  {showUndetectedLocal ? "Hide" : "Show"} other targets ({undetectedLocal.length})
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-slate-500 shrink-0 transition-transform group-hover:text-slate-400",
                    showUndetectedLocal && "rotate-180",
                  )}
                />
              </button>
              {showUndetectedLocal && (
                <div className="grid gap-4 min-w-0 w-full">
                  {undetectedRenderOrder.map((item) =>
                    item.type === "entry" ? (
                      <HardwareProviderCard key={item.entry.id} provider={item.entry} {...providerCardProps} />
                    ) : (
                      <div key={`group-${item.heading}`} className="space-y-3">
                        <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-800/60 pb-1.5">
                          {item.heading}
                        </p>
                        <div className="grid gap-4 min-w-0 w-full">
                          {item.entries.map((p) => (
                            <HardwareProviderCard key={p.id} provider={p} {...providerCardProps} />
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowExportTargets((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left cursor-pointer group"
            aria-expanded={showExportTargets}
          >
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 group-hover:text-slate-400">
              Export &amp; platform targets ({exportAndPlatformTargets.length})
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-slate-500 shrink-0 transition-transform group-hover:text-slate-400",
                showExportTargets && "rotate-180",
              )}
            />
          </button>
          {!showExportTargets && (
            <p className="text-xs text-slate-600">
              Deploy/export targets for other runtimes (mobile, browser, edge) — not local
              execution providers on this machine.
            </p>
          )}
          {showExportTargets && (
            <div className="grid gap-4 min-w-0 w-full">
              {exportAndPlatformTargets.map((p) => (
                <HardwareProviderCard key={p.id} provider={p} {...providerCardProps} />
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
