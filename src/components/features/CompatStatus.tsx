import { CheckCircle2, CircleHelp, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecipeHardwareCompatTier } from "@/lib/recipeHardwareCompatibility";

const TIER_UI: Record<RecipeHardwareCompatTier, { label: string; Icon: LucideIcon; className: string }> = {
  compatible: {
    label: "Compatible",
    Icon: CheckCircle2,
    className: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
  unavailable: {
    label: "Incompatible",
    Icon: XCircle,
    className: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  },
  unknown: {
    label: "Unverified",
    Icon: CircleHelp,
    className: "text-slate-400 border-slate-700 bg-slate-900/60",
  },
};

interface CompatStatusPillProps {
  tier: RecipeHardwareCompatTier;
  className?: string;
  /** Compact chip for dense lists */
  size?: "sm" | "md";
}

/** Color plus icon so hardware status is not color-only. */
export function CompatStatusPill({ tier, className, size = "sm" }: CompatStatusPillProps) {
  const { label, Icon, className: tierClass } = TIER_UI[tier];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-mono",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        tierClass,
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

interface CompatCountProps {
  compatible: number;
  incompatible: number;
  className?: string;
}

/** Summary counts with icons (not color alone). */
export function CompatCountSummary({ compatible, incompatible, className }: CompatCountProps) {
  return (
    <p
      className={cn(
        "text-xs text-slate-300 mt-1 leading-relaxed flex flex-wrap items-center gap-x-2 gap-y-1",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1 text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        {compatible} compatible
      </span>
      <span className="text-slate-600" aria-hidden>
        ·
      </span>
      <span className="inline-flex items-center gap-1 text-rose-400">
        <XCircle className="h-3.5 w-3.5" aria-hidden />
        {incompatible} incompatible
      </span>
    </p>
  );
}
