import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded border border-slate-800 bg-slate-900/40 text-slate-100", className)}>{children}</div>;
}

export function CardHeader({ title, description, badge, tooltip, titleId }: { title: string; description?: string; badge?: React.ReactNode; tooltip?: string; titleId?: string }) {
  return <div className="flex flex-col gap-1 p-5 pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div id={titleId} className="text-base font-semibold text-slate-100 flex items-center gap-2">{title}{tooltip && <span title={tooltip} className="cursor-help"><Info className="h-3.5 w-3.5 text-slate-500 shrink-0" /></span>}</div>{description && <p className="text-sm text-slate-400 mt-1">{description}</p>}</div>{badge}</div></div>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("p-5 pt-0", className)}>{children}</div>;
}
