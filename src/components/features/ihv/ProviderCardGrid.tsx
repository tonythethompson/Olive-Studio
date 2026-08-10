/**
 * ProviderCardGrid — Provider card grid with local accelerators and export/platform sections.
 * Extracted from IHVIntegrationPanel (Task 6).
 */
import { TooltipProvider } from "@/components/ui/Tooltip";
import { HardwareProviderCard, type HardwareProviderCardProps } from "./HardwareProviderCard";
import { RefreshCw } from "lucide-react";
import type { ProviderCatalogEntry } from "@/lib/providerCatalog";

export interface ProviderCardGridProps {
  probeLoading: boolean;
  localAccelerators: ProviderCatalogEntry[];
  exportAndPlatformTargets: ProviderCatalogEntry[];
  providerCardProps: Omit<HardwareProviderCardProps, "provider">;
}

export function ProviderCardGrid({
  probeLoading,
  localAccelerators,
  exportAndPlatformTargets,
  providerCardProps,
}: ProviderCardGridProps) {
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
        {([
          { label: "Local accelerators", items: localAccelerators },
          { label: "Export & platform targets", items: exportAndPlatformTargets },
        ] as const).map((section) => (
          <div key={section.label} className="space-y-3">
            <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              {section.label}
            </p>
            <div className="grid gap-4 min-w-0 w-full">
              {section.items.map((p) => (
                <HardwareProviderCard key={p.id} provider={p} {...providerCardProps} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
